import { onRequestGet, onRequestOptions } from '../functions/api/public-config.js';

export const GET = () => onRequestGet({ env: process.env });
export const OPTIONS = () => onRequestOptions();
