// The MicroPython mode that runs on the robot (src/py/drawer_mode.py) as a module for the robot's file system.
import SOURCE from './py/drawer_mode.py?raw';
import { buildModuleFrom, moduleNameFor } from './script-core.js';

export const SOURCE_TEXT = SOURCE;
export const MODULE_TEXT = buildModuleFrom(SOURCE);
export const MODULE_NAME = moduleNameFor(MODULE_TEXT);
