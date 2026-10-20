from __future__ import annotations

import json
import logging
import math
import os
import sqlite3
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated
from mimetypes import guess_type

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = ROOT.parent
DATA_DIRECTORY = ROOT / "data"
UPLOAD_DIRECTORY = DATA_DIRECTORY / "uploads"
FRAME_DIRECTORY = DATA_DIRECTORY / "frames"
DATABASE_PATH = DATA_DIRECTORY / "aeroview.sqlite3"
MODEL_PATH = PROJECT_ROOT / "best.pt"
MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024
FRAME_INTERVAL_SECONDS = 0.25
FRAME_BATCH_SIZE = 16
MODEL_CONFIDENCE = 0.25
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi"}
PROCESSING_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="aeroview-video")
MODEL_LOCK = threading.Lock()
INFERENCE_LOCK = threading.Lock()
_model = None
logger = logging.getLogger(__name__)


def get_database() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database() -> None:
    DATA_DIRECTORY.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    FRAME_DIRECTORY.mkdir(parents=True, exist_ok=True)
    with get_database() as database:
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS uploaded_videos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                uploaded_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'queued',
                processing_progress INTEGER NOT NULL DEFAULT 0,
                processed_frames INTEGER NOT NULL DEFAULT 0,
                frame_count INTEGER NOT NULL DEFAULT 0,
                detection_count INTEGER NOT NULL DEFAULT 0,
                duration_seconds REAL NOT NULL DEFAULT 0,
                error_message TEXT
            )
            """
        )
        existing_columns = {
            column["name"] for column in database.execute("PRAGMA table_info(uploaded_videos)")
        }
        new_columns = {
            "processing_progress": "INTEGER NOT NULL DEFAULT 0",
            "processed_frames": "INTEGER NOT NULL DEFAULT 0",
            "frame_count": "INTEGER NOT NULL DEFAULT 0",
            "detection_count": "INTEGER NOT NULL DEFAULT 0",
            "duration_seconds": "REAL NOT NULL DEFAULT 0",
            "error_message": "TEXT",
        }
        for column_name, declaration in new_columns.items():
            if column_name not in existing_columns:
                database.execute(f"ALTER TABLE uploaded_videos ADD COLUMN {column_name} {declaration}")
        database.execute(
            """
            CREATE TABLE IF NOT EXISTS video_frames (
                video_id TEXT NOT NULL REFERENCES uploaded_videos(id) ON DELETE CASCADE,
                frame_index INTEGER NOT NULL,
                timestamp_seconds REAL NOT NULL,
                source_timestamp_seconds REAL NOT NULL DEFAULT 0,
                file_name TEXT NOT NULL,
                detections_json TEXT NOT NULL,
                PRIMARY KEY (video_id, frame_index)
            )
            """
        )
        frame_columns = {
            column["name"] for column in database.execute("PRAGMA table_info(video_frames)")
        }
        if "source_timestamp_seconds" not in frame_columns:
            database.execute(
                "ALTER TABLE video_frames ADD COLUMN source_timestamp_seconds REAL NOT NULL DEFAULT 0"
            )
            database.execute(
                """
                UPDATE video_frames
                SET source_timestamp_seconds = timestamp_seconds
                """
            )
            database.execute(
                """
                WITH numbered_frames AS (
                    SELECT video_id, frame_index,
                        (ROW_NUMBER() OVER (PARTITION BY video_id ORDER BY frame_index) - 1) * ? AS sample_time
                    FROM video_frames
                )
                UPDATE video_frames
                SET timestamp_seconds = (
                    SELECT sample_time FROM numbered_frames
                    WHERE numbered_frames.video_id = video_frames.video_id
                        AND numbered_frames.frame_index = video_frames.frame_index
                )
                """,
                (FRAME_INTERVAL_SECONDS,),
            )


initialize_database()


def load_model():
    global _model
    with MODEL_LOCK:
        if _model is None:
            if not MODEL_PATH.is_file():
                raise FileNotFoundError(f"Файл модели не найден: {MODEL_PATH}")
            from ultralytics import YOLO

            _model = YOLO(str(MODEL_PATH))
        return _model


def update_video(video_id: str, **values: object) -> None:
    assignments = ", ".join(f"{column} = ?" for column in values)
    with get_database() as database:
        database.execute(
            f"UPDATE uploaded_videos SET {assignments} WHERE id = ?",
            (*values.values(), video_id),
        )


def enqueue_video_processing(video_id: str) -> None:
    PROCESSING_POOL.submit(process_video, video_id)


def resume_interrupted_jobs() -> None:
    with get_database() as database:
        rows = database.execute(
            "SELECT id FROM uploaded_videos WHERE status IN ('queued', 'processing') ORDER BY uploaded_at"
        ).fetchall()
        database.execute(
            """
            UPDATE uploaded_videos
            SET status = 'queued', processing_progress = 0, error_message = NULL
            WHERE status = 'processing'
            """
        )
    for row in rows:
        enqueue_video_processing(row["id"])


def process_video(video_id: str) -> None:
    with get_database() as database:
        video = database.execute(
            "SELECT stored_name FROM uploaded_videos WHERE id = ?", (video_id,)
        ).fetchone()
    if video is None:
        return

    video_path = UPLOAD_DIRECTORY / video["stored_name"]
    output_directory = FRAME_DIRECTORY / video_id
    capture = None
    pending_frames: list[tuple[str, int, float, float, str, str]] = []
    sampled_count = 0
    detections_count = 0
    total_frame_count = 0
    duration_seconds = 0.0

    try:
        import cv2

        output_directory.mkdir(parents=True, exist_ok=True)
        for partial_frame in output_directory.iterdir():
            if partial_frame.is_file():
                partial_frame.unlink()
        with get_database() as database:
            database.execute("DELETE FROM video_frames WHERE video_id = ?", (video_id,))
        update_video(
            video_id,
            status="processing",
            processing_progress=0,
            processed_frames=0,
            detection_count=0,
            error_message=None,
        )
        model = load_model()
        capture = cv2.VideoCapture(str(video_path))
        if not capture.isOpened():
            raise ValueError("Не удалось открыть видео. Проверьте файл и поддерживаемый кодек.")

        fps = float(capture.get(cv2.CAP_PROP_FPS))
        total_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        if not math.isfinite(fps) or fps <= 0:
            raise ValueError("Не удалось определить частоту кадров видео.")
        if total_frame_count <= 0:
            raise ValueError("В видео не найдено кадров для обработки.")
        duration_seconds = total_frame_count / fps

        sample_number = 0
        frame_index = 0
        target_frame_index = 0
        inference_device = os.environ.get("AEROVIEW_DEVICE", "cpu")

        while True:
            success, frame = capture.read()
            if not success:
                break
            if frame_index >= target_frame_index:
                with INFERENCE_LOCK:
                    result = model.predict(
                        source=frame,
                        imgsz=640,
                        conf=MODEL_CONFIDENCE,
                        device=inference_device,
                        verbose=False,
                    )[0]
                frame_detections = []
                if result.boxes is not None:
                    box_coordinates = result.boxes.xyxy.cpu().tolist()
                    classes = result.boxes.cls.int().cpu().tolist()
                    confidences = result.boxes.conf.cpu().tolist()
                    for box, class_id, confidence in zip(box_coordinates, classes, confidences, strict=True):
                        frame_detections.append(
                            {
                                "class_id": class_id,
                                "name": str(model.names[class_id]),
                                "confidence": round(float(confidence), 5),
                                "bbox": [round(float(coordinate), 2) for coordinate in box],
                            }
                        )

                frame_file_name = f"frame_{frame_index:08d}.jpg"
                encoded, jpeg = cv2.imencode(
                    ".jpg",
                    result.plot(),
                    [cv2.IMWRITE_JPEG_QUALITY, 88],
                )
                if not encoded:
                    raise OSError(f"Не удалось сохранить кадр {frame_index}.")
                (output_directory / frame_file_name).write_bytes(jpeg.tobytes())
                pending_frames.append(
                    (
                        video_id,
                        frame_index,
                        sample_number * FRAME_INTERVAL_SECONDS,
                        frame_index / fps,
                        frame_file_name,
                        json.dumps(frame_detections, ensure_ascii=False),
                    )
                )
                sampled_count += 1
                detections_count += len(frame_detections)
                sample_number += 1
                target_frame_index = round(sample_number * FRAME_INTERVAL_SECONDS * fps)
                if target_frame_index <= frame_index:
                    target_frame_index = frame_index + 1

            frame_index += 1
            progress = min(99, int(frame_index * 100 / total_frame_count))
            if len(pending_frames) >= FRAME_BATCH_SIZE or (
                frame_index >= total_frame_count and pending_frames
            ):
                with get_database() as database:
                    database.executemany(
                        """
                        INSERT INTO video_frames (
                            video_id, frame_index, timestamp_seconds, source_timestamp_seconds,
                            file_name, detections_json
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        pending_frames,
                    )
                pending_frames.clear()
                update_video(
                    video_id,
                    processing_progress=progress,
                    processed_frames=sampled_count,
                    frame_count=total_frame_count,
                    detection_count=detections_count,
                    duration_seconds=duration_seconds,
                )

        if pending_frames:
            with get_database() as database:
                database.executemany(
                    """
                    INSERT INTO video_frames (
                        video_id, frame_index, timestamp_seconds, source_timestamp_seconds,
                        file_name, detections_json
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    pending_frames,
                )
        if sampled_count == 0:
            raise ValueError("Из видео не удалось извлечь ни одного кадра.")
        update_video(
            video_id,
            status="processed",
            processing_progress=100,
            processed_frames=sampled_count,
            frame_count=total_frame_count,
            detection_count=detections_count,
            duration_seconds=duration_seconds,
            error_message=None,
        )
    except Exception as error:
        logger.exception("Обработка видео %s завершилась ошибкой", video_id)
        update_video(
            video_id,
            status="failed",
            processed_frames=sampled_count,
            frame_count=total_frame_count,
            detection_count=detections_count,
            duration_seconds=duration_seconds,
            error_message=str(error)[:1500],
        )
    finally:
        if capture is not None:
            capture.release()


@asynccontextmanager
async def application_lifespan(_app: FastAPI):
    resume_interrupted_jobs()
    yield
    PROCESSING_POOL.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title="AeroView API", version="1.0.0", lifespan=application_lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def seed_videos() -> list[dict]:
    now = datetime.now(timezone.utc).astimezone()
    fixed_videos = [
        {
            "title": "Северный борт · Облёт №128",
            "drone": "DJI Matrice 350",
            "size": 2.4,
            "duration": "18:24",
            "age_days": 0,
            "status": "processing",
            "progress": 68,
            "thumbnail": "construction",
            "hour": 9,
            "minute": 42,
        },
        {
            "title": "Лесной участок · Облёт №127",
            "drone": "DJI Mavic 3E",
            "size": 1.6,
            "duration": "12:08",
            "age_days": 0,
            "status": "processed",
            "progress": 100,
            "thumbnail": "forest",
            "hour": 8,
            "minute": 15,
        },
        {
            "title": "Промзона · Облёт №126",
            "drone": "DJI Matrice 350",
            "size": 3.1,
            "duration": "24:36",
            "age_days": 1,
            "status": "processed",
            "progress": 100,
            "thumbnail": "city",
            "hour": 16,
            "minute": 30,
        },
        {
            "title": "Западный борт · Облёт №125",
            "drone": "DJI Matrice 350",
            "size": 2.2,
            "duration": "16:42",
            "age_days": 1,
            "status": "processing",
            "progress": 0,
            "thumbnail": "construction",
            "hour": 14,
            "minute": 10,
        },
        {
            "title": "Подъездные пути · Облёт №124",
            "drone": "DJI Mavic 3E",
            "size": 1.2,
            "duration": "09:56",
            "age_days": 3,
            "status": "processed",
            "progress": 100,
            "thumbnail": "city",
            "hour": 11,
            "minute": 25,
        },
        {
            "title": "Граница участка · Облёт №123",
            "drone": "DJI Mavic 3E",
            "size": 1.8,
            "duration": "14:18",
            "age_days": 3,
            "status": "failed",
            "progress": 0,
            "thumbnail": "forest",
            "hour": 9,
            "minute": 0,
        },
    ]
    sites = ["Карьер", "Северный борт", "Лесной участок", "Промзона", "Подъездные пути", "Южный сектор"]
    drones = ["DJI Matrice 350", "DJI Mavic 3E"]
    thumbnails = ["construction", "forest", "city"]
    records = []

    for index in range(1248):
        if index < len(fixed_videos):
            video = fixed_videos[index].copy()
            number = 128 - index
        else:
            extra_index = index - len(fixed_videos)
            age_days = 4 + extra_index % 90
            hour = 8 + (extra_index * 7 % 11)
            minute = (extra_index * 13) % 60
            if index < 10:
                status, progress = "processing", 24 + (extra_index * 11 % 69)
            elif index < 1247:
                status, progress = "processed", 100
            else:
                status, progress = "failed", 0
            video = {
                "title": f"{sites[extra_index % len(sites)]} · Облёт №{122 - extra_index}",
                "drone": drones[extra_index % len(drones)],
                "size": round(1.1 + (extra_index % 24) * 0.13, 1),
                "duration": f"{9 + extra_index % 19:02d}:{(extra_index * 17) % 60:02d}",
                "age_days": age_days,
                "status": status,
                "progress": progress,
                "thumbnail": thumbnails[extra_index % len(thumbnails)],
                "hour": hour,
                "minute": minute,
            }
            number = 122 - extra_index

        video_date = now - timedelta(days=video["age_days"])
        records.append(
            {
                "id": f"demo-{number}",
                "title": video["title"],
                "drone": video["drone"],
                "size_gb": video["size"],
                "duration": video["duration"],
                "created_at": video_date.replace(
                    hour=video["hour"], minute=video["minute"], second=0, microsecond=0
                ).isoformat(),
                "status": video["status"],
                "progress": video["progress"],
                "thumbnail": video["thumbnail"],
                "source": "demo",
                "storage_name": None,
            }
        )
    return records


DEMO_VIDEOS = seed_videos()


def uploaded_videos() -> list[dict]:
    with get_database() as database:
        rows = database.execute(
            """
            SELECT id, title, file_size, uploaded_at, status, processing_progress,
                processed_frames, frame_count, detection_count, duration_seconds, error_message
            FROM uploaded_videos ORDER BY uploaded_at DESC
            """
        ).fetchall()
    return [
        {
            "id": row["id"],
            "title": row["title"],
            "drone": "Загруженное видео",
            "size_gb": round(row["file_size"] / (1024**3), 2),
            "duration": (
                f"{int(row['duration_seconds']) // 60:02d}:{int(row['duration_seconds']) % 60:02d}"
                if row["duration_seconds"] > 0
                else "--:--"
            ),
            "created_at": row["uploaded_at"],
            "status": row["status"],
            "progress": row["processing_progress"],
            "processed_frames": row["processed_frames"],
            "frame_count": row["frame_count"],
            "detection_count": row["detection_count"],
            "duration_seconds": row["duration_seconds"],
            "error_message": row["error_message"],
            "thumbnail": "construction",
            "source": "upload",
            "storage_name": None,
        }
        for row in rows
    ]


def account_statistics(videos: list[dict]) -> dict:
    totals = {"all": 1248, "processed": 1240, "processing": 6, "failed": 2}
    for video in videos:
        if video["source"] == "upload":
            totals["all"] += 1
            counter = video["status"] if video["status"] in ("processed", "processing", "failed") else "processing"
            totals[counter] += 1
    return totals


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "AeroView API",
        "model_available": MODEL_PATH.is_file(),
        "model_class": "waste",
        "inference_device": os.environ.get("AEROVIEW_DEVICE", "cpu"),
        "frame_interval_seconds": FRAME_INTERVAL_SECONDS,
    }


@app.get("/api/videos")
def list_videos(
    query: Annotated[str, Query(max_length=200)] = "",
    status: Annotated[str | None, Query(pattern="^(processed|processing|failed)$")] = None,
    drone: Annotated[str | None, Query(max_length=100)] = None,
    period: Annotated[str, Query(pattern="^(all|today|week|month)$")] = "all",
    sort: Annotated[str, Query(pattern="^(newest|oldest|name|size)$")] = "newest",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=24)] = 6,
) -> dict:
    videos = [video.copy() for video in DEMO_VIDEOS] + uploaded_videos()
    normalized_query = query.casefold().strip()
    filtered = videos

    if normalized_query:
        filtered = [video for video in filtered if normalized_query in video["title"].casefold()]
    if status:
        filtered = [
            video
            for video in filtered
            if video["status"] == status or (status == "processing" and video["status"] == "queued")
        ]
    if drone:
        filtered = [video for video in filtered if video["drone"] == drone]
    if period != "all":
        now = datetime.now().astimezone()
        cutoff = (
            now.replace(hour=0, minute=0, second=0, microsecond=0)
            if period == "today"
            else now - timedelta(days=7 if period == "week" else 30)
        )
        filtered = [
            video
            for video in filtered
            if datetime.fromisoformat(video["created_at"]).astimezone() >= cutoff
        ]

    if sort == "oldest":
        filtered.sort(key=lambda video: video["created_at"])
    elif sort == "name":
        filtered.sort(key=lambda video: video["title"].casefold())
    elif sort == "size":
        filtered.sort(key=lambda video: video["size_gb"], reverse=True)
    else:
        filtered.sort(key=lambda video: video["created_at"], reverse=True)

    start = (page - 1) * page_size
    page_videos = filtered[start : start + page_size]
    for video in page_videos:
        video["size"] = f'{video["size_gb"]:.2f}'.rstrip("0").rstrip(".").replace(".", ",") + " ГБ"

    return {
        "items": page_videos,
        "total": len(filtered),
        "page": page,
        "page_size": page_size,
        "statistics": account_statistics(videos),
        "storage": {"used_gb": 186 + sum(video["size_gb"] for video in videos if video["source"] == "upload"), "total_gb": 500},
    }


@app.get("/api/videos/{video_id}/frames")
def get_video_frames(
    video_id: str,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=48)] = 12,
) -> dict:
    with get_database() as database:
        video = database.execute(
            "SELECT processed_frames, status FROM uploaded_videos WHERE id = ?",
            (video_id,),
        ).fetchone()
        if video is None:
            raise HTTPException(status_code=404, detail="Видеозапись не найдена.")
        total = database.execute(
            "SELECT COUNT(*) FROM video_frames WHERE video_id = ?", (video_id,)
        ).fetchone()[0]
        rows = database.execute(
            """
            SELECT frame_index, timestamp_seconds, source_timestamp_seconds, detections_json
            FROM video_frames
            WHERE video_id = ?
            ORDER BY frame_index
            LIMIT ? OFFSET ?
            """,
            (video_id, page_size, (page - 1) * page_size),
        ).fetchall()
    return {
        "items": [
            {
                "frame_index": row["frame_index"],
                "timestamp_seconds": row["timestamp_seconds"],
                "frame_timestamp_seconds": row["source_timestamp_seconds"],
                "image_url": f"/api/videos/{video_id}/frames/{row['frame_index']}/image",
                "detections": json.loads(row["detections_json"]),
            }
            for row in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
        "interval_seconds": FRAME_INTERVAL_SECONDS,
        "status": video["status"],
        "processed_frames": video["processed_frames"],
    }


@app.get("/api/videos/{video_id}/frames/{frame_index}/image")
def get_video_frame_image(
    video_id: str,
    frame_index: int,
) -> FileResponse:
    if frame_index < 0:
        raise HTTPException(status_code=422, detail="Номер кадра не может быть отрицательным.")
    with get_database() as database:
        row = database.execute(
            "SELECT file_name FROM video_frames WHERE video_id = ? AND frame_index = ?",
            (video_id, frame_index),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Кадр не найден.")

    output_directory = (FRAME_DIRECTORY / video_id).resolve()
    frame_path = (output_directory / row["file_name"]).resolve()
    if frame_path.parent != output_directory or not frame_path.is_file():
        raise HTTPException(status_code=404, detail="Файл кадра отсутствует в хранилище.")
    return FileResponse(path=frame_path, media_type="image/jpeg")


@app.get("/api/videos/{video_id}/file")
def get_uploaded_file(video_id: str) -> FileResponse:
    with get_database() as database:
        row = database.execute(
            "SELECT original_name, stored_name FROM uploaded_videos WHERE id = ?",
            (video_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Видеофайл не найден.")

    file_path = (UPLOAD_DIRECTORY / row["stored_name"]).resolve()
    if file_path.parent != UPLOAD_DIRECTORY.resolve() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Видеофайл отсутствует в хранилище.")
    return FileResponse(
        path=file_path,
        media_type=guess_type(row["original_name"])[0] or "application/octet-stream",
        filename=row["original_name"],
        content_disposition_type="inline",
    )


@app.post("/api/videos/upload", status_code=201)
async def upload_video(
    background_tasks: BackgroundTasks,
    file: Annotated[UploadFile, File()],
) -> dict:
    original_name = (file.filename or "").replace("\\", "/").split("/")[-1].strip()
    extension = Path(original_name).suffix.lower()
    if not original_name or extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Поддерживаются форматы MP4, MOV и AVI.")

    video_id = str(uuid.uuid4())
    stored_name = f"{video_id}{extension}"
    destination = UPLOAD_DIRECTORY / stored_name
    size = 0

    try:
        with destination.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Размер видео превышает ограничение 10 ГБ.")
                output.write(chunk)

        if size == 0:
            raise HTTPException(status_code=400, detail="Загруженный видеофайл пуст.")

        uploaded_at = datetime.now(timezone.utc).astimezone().isoformat()
        with get_database() as database:
            database.execute(
                """
                INSERT INTO uploaded_videos (
                    id, title, original_name, stored_name, file_size, uploaded_at, status
                ) VALUES (?, ?, ?, ?, ?, ?, 'queued')
                """,
                (video_id, Path(original_name).stem[:160], original_name[:255], stored_name, size, uploaded_at),
            )
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    background_tasks.add_task(enqueue_video_processing, video_id)
    return {
        "id": video_id,
        "title": Path(original_name).stem[:160],
        "size_gb": round(size / (1024**3), 4),
        "created_at": uploaded_at,
        "status": "queued",
        "processing_progress": 0,
        "frame_interval_seconds": FRAME_INTERVAL_SECONDS,
    }
