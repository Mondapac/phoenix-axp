// Violation: no-cross-panel-imports (twice).
import { adminMenu } from '@phoenix/admin/menu';
import { other } from '../../../admin/app/menu';

export const menus = [adminMenu, other];
