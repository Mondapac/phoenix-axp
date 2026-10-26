// Allowed: platform/worker/ reads appRole.
declare const config: { appRole: string };

export const isWorker = config.appRole === 'worker';
