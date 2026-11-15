import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const wavsQRConfigPath = path.resolve(directory, '../config/WavsQRLogin.yaml');
export const wavsQRLocalConfigPath = path.resolve(directory, '../config/WavsQRLogin.local.yaml');
const defaultConfig = { databasePath: '' };

function readFile(file) {
  if (!fs.existsSync(file)) return {};
  const value = parse(fs.readFileSync(file, 'utf8'));
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function readWavsQRConfig() {
  return { ...defaultConfig, ...readFile(wavsQRConfigPath), ...readFile(wavsQRLocalConfigPath) };
}

export function saveWavsQRConfig(value) {
  if (!value || typeof value.databasePath !== 'string') throw new Error('GsData.db 路径必须是文本');
  const config = { databasePath: value.databasePath.trim() };
  fs.mkdirSync(path.dirname(wavsQRLocalConfigPath), { recursive: true });
  const temporary = `${wavsQRLocalConfigPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, stringify(config), { mode: 0o600 });
  fs.renameSync(temporary, wavsQRLocalConfigPath);
  return readWavsQRConfig();
}
