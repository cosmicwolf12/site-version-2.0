const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = __dirname;
const publicDirectory = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const apiPort = Number(process.env.API_PORT || 8000);
const apiBase = `http://127.0.0.1:${apiPort}`;
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

let apiProcess;
let shuttingDown = false;

function startApi() {
  if (process.env.AEROVIEW_START_API === "0") {
    console.log(`FastAPI не запущен автоматически. Ожидается API на ${apiBase}.`);
    return;
  }

  const virtualEnvPython = path.join(root, ".venv", "Scripts", "python.exe");
  const command = fs.existsSync(virtualEnvPython) ? virtualEnvPython : "py";
  const args = fs.existsSync(virtualEnvPython)
    ? ["-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(apiPort)]
    : ["-3", "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", String(apiPort)];

  apiProcess = spawn(command, args, { cwd: root, stdio: "inherit", windowsHide: true });
  apiProcess.on("error", (error) => {
    console.error(`Не удалось запустить FastAPI: ${error.message}`);
    console.error("Запустите setup.bat, чтобы установить Python-зависимости.");
  });
  apiProcess.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`FastAPI завершился с кодом ${code}. Проверьте Python-зависимости и порт ${apiPort}.`);
    }
  });
}

function sendJson(response, statusCode, message) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ detail: message }));
}

function proxyApi(request, response) {
  const target = new URL(request.url, apiBase);
  const upstream = http.request(
    target,
    {
      method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${apiPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );

  upstream.on("error", () => {
    if (!response.headersSent) {
      sendJson(response, 502, "API FastAPI недоступно. Установите зависимости через setup.bat и перезапустите сайт.");
    }
  });
  request.pipe(upstream);
}

function serveFile(request, response) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const filePath = path.resolve(publicDirectory, relativePath);
  const isInsidePublic = filePath.startsWith(`${publicDirectory}${path.sep}`);

  if (!isInsidePublic) {
    sendJson(response, 403, "Недопустимый путь.");
    return;
  }

  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Файл не найден.");
      return;
    }

    response.writeHead(200, {
      "Content-Length": stat.size,
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(response);
  });
}

const server = http.createServer((request, response) => {
  if (request.url.startsWith("/api/")) {
    proxyApi(request, response);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJson(response, 405, "Метод не поддерживается.");
    return;
  }

  serveFile(request, response);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`AeroView открыт по адресу http://localhost:${port}`);
  startApi();
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close();
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
