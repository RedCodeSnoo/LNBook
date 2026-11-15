import { deviceFiles } from './deviceFileStore';
import { ErrorLog } from './errorLog';

/** The journal of this phone (see errorLog.ts). */
export const errorLog = new ErrorLog(deviceFiles);
