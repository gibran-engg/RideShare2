// Preloaded into each service started by scripts/dev.ts: exit when the runner goes away
// (on Windows, killing the runner does not kill its children).
if (process.send) {
    process.on("disconnect", () => process.exit(0));
}
