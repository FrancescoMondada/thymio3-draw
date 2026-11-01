// Single import site for the Thymio 3 API (same pattern as the cockpit).
//
// `?fakerobot` in the address replaces Web Bluetooth and the robot by a demonstration robot
// (dev/fake-thymio.js) with the same interface: the whole application can be tried with no hardware.
import * as realApi from 'thymio-api';
import * as fakeApi from './dev/fake-thymio.js';

const useFake = typeof location !== 'undefined' && new URLSearchParams(location.search).has('fakerobot');

export const thymio = useFake ? fakeApi : realApi;
export const isFakeRobot = useFake;

export const EVENTS = {
  connected: 'thymio-connected',
  manualReconnect: 'thymio-prompt-manual-reconnection',
  stdout: 'thymio-std-out-values',
  pyStatus: 'thymio-python-execution-status',
  pyLoad: 'thymio-python-load-result',
};

export const supportsBluetooth = () => useFake || (typeof navigator !== 'undefined' && 'bluetooth' in navigator);
