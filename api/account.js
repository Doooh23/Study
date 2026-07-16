import { onRequestGet, onRequestOptions, onRequestPatch } from '../functions/api/account.js';

export const GET = (request) => onRequestGet({ request, env: process.env });
export const PATCH = (request) => onRequestPatch({ request, env: process.env });
export const OPTIONS = () => onRequestOptions();
