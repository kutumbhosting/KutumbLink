import fs from "fs";
import path from "path";

// The project root .env file — same file dotenv/config already reads on
// boot. This module lets the running app safely update a single value in
// it (used for rotating DATABASE_URL from the admin console) without
// touching any other line.
const ENV_PATH = path.join(process.cwd(), ".env");

export function readEnvFile() {
  return fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
}

// Replaces `KEY=...` if it exists (preserving every other line untouched),
// or appends a new `KEY=value` line if it doesn't. Rejects values containing
// newlines so a malformed paste can't corrupt the rest of the file.
export function setEnvVar(key, value) {
  if (/[\r\n]/.test(value)) {
    throw new Error("Value cannot contain line breaks");
  }

  const content = readEnvFile();
  const lines = content.split(/\r?\n/);
  const pattern = new RegExp(`^${key}=`);
  let found = false;

  const updated = lines.map((line) => {
    if (pattern.test(line)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });

  if (!found) {
    if (updated.length && updated[updated.length - 1] !== "") updated.push("");
    updated.push(`${key}=${value}`);
  }

  fs.writeFileSync(ENV_PATH, updated.join("\n"));
}
