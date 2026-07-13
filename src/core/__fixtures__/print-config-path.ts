// Test fixture (FIN-77): spawned as a standalone child process by
// config.test.ts to prove that two genuinely concurrent OS processes with
// divergent $HOME values resolve to the identical default config path and
// refresh-lock path — not just two sequential calls inside one process.
// Never reads or writes the config file itself, only prints the resolved
// path strings.
import { configPath } from "../config";

process.stdout.write(JSON.stringify({ configPath: configPath(), lockPath: `${configPath()}.refresh.lock` }));
