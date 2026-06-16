/**
 * Shared utilities for session_daemon.js and lazy_server.js
 */

import fs from 'fs';
import { URL } from 'url';

const CONFIG_FILE = new URL('../config.json', import.meta.url).pathname;

/**
 * Get available accounts (not depleted, not in cooldown, active)
 * Shared between Pool and Lazy modes
 *
 * @param {Function} loadConfigFn - Config loader function (supports caching)
 * @param {boolean} useSeconds - If true, use seconds for time comparison (lazy mode)
 *                                If false, use milliseconds (pool mode)
 * @returns {Array} Array of available accounts
 */
export function getAvailableAccounts(loadConfigFn, useSeconds = true) {
  const cfg = loadConfigFn();
  const now = useSeconds ? Math.floor(Date.now() / 1000) : Date.now();

  return (cfg.accounts || []).filter(acc => {
    if (!acc.email || !acc.password) return false;
    if (acc.depleted) return false;
    if (acc.is_active === false) return false;

    // Check temporary credit exhaustion cooldown
    if (acc.temporarily_no_credits && acc.credits_check_after) {
      if (now < acc.credits_check_after) {
        return false; // Still in cooldown
      }
      // Note: Cooldown expired - caller should clear flag if needed
    }

    return true;
  });
}
