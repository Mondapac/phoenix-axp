// Allowed: server code reads the environment and uses the BFF helpers.
import { readPanelServerConfig } from '@phoenix/panel-server';
import { headers } from 'next/headers';

export const config = () => readPanelServerConfig(process.env, 'STUDIO_TENANT_HOSTS');
export const incoming = () => headers();
