import { json, options } from './_shared.js';
import { publicPlatformConfig } from './_platform.js';

export const onRequestOptions = () => options();
export const onRequestGet = ({ env }) => json({ ok: true, ...publicPlatformConfig(env) });
