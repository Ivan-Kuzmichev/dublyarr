import { spawn } from "node:child_process";

const procs = [];
let stopping = false;

function shutdown(code) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) p.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
}

function run(name, args) {
  const p = spawn("npm", args, { cwd: "/app", stdio: "inherit", env: process.env });
  p.on("exit", (code) => {
    console.log(`[supervisor] ${name} завершился с кодом ${code}`);
    shutdown(code ?? 1);
  });
  procs.push(p);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

run("web", ["run", "start", "-w", "@dublyarr/web"]);
run("worker", ["run", "start", "-w", "@dublyarr/worker"]);
