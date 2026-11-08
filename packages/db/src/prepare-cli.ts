// The `migrate` service of infra/production/compose.yml runs this file.
import { prepareDatabase } from "./prepare.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
}

await prepareDatabase(
  required("OWNER_DATABASE_URL"),
  required("APP_DB_PASSWORD"),
);
console.log("database ready");
