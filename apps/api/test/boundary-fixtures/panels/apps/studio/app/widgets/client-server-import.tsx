'use client';
// Violation: panel-server-is-server-only (three imports a client module may not make).
import { relayToApi } from '@phoenix/panel-server';
import { cookies } from 'next/headers';
import { config } from '../_server/panel';

export const leaked = [relayToApi, cookies, config];
