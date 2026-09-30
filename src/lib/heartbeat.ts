import type { Db } from './db/client';
import type { ServiceStatus } from '@/components/ui/StatusDot';

// Реальные heartbeats появятся вместе с воркером (задача 12).
export function serviceStatuses(_db: Db): ServiceStatus[] {
  return [];
}
