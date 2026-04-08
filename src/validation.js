'use strict';

// ─── INPUT VALIDATION UTILITIES ──────────────────────────────────────────────

const VALID_RANKS = new Set(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const VALID_SUITS = new Set(['♠', '♥', '♦', '♣']);

// Card ID format: {RANK}{SUIT}_{DECK_INDEX}  e.g. "A♠_0", "10♥_1"
const CARD_ID_RE = /^(A|[2-9]|10|J|Q|K)(♠|♥|♦|♣)_[01]$/;

/**
 * Sanitize a player name: trim, limit length, strip control chars and HTML.
 * Returns null if the result is empty.
 */
function sanitizeName(raw) {
  if (typeof raw !== 'string') return null;
  // Strip control characters and HTML tags
  const cleaned = raw
    .replace(/[\x00-\x1F\x7F]/g, '') // control chars
    .replace(/<[^>]*>/g, '') // HTML tags
    .trim()
    .slice(0, 10);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Validate a room ID format (6 uppercase alphanumeric chars, no ambiguous chars).
 */
function isValidRoomId(roomId) {
  if (typeof roomId !== 'string') return false;
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(roomId);
}

/**
 * Validate a card ID matches the expected format.
 */
function isValidCardId(cardId) {
  if (typeof cardId !== 'string') return false;
  return CARD_ID_RE.test(cardId);
}

/**
 * Validate a player/seat index is an integer in [0, 3].
 */
function isValidSeatIndex(idx) {
  return Number.isInteger(idx) && idx >= 0 && idx < 4;
}

/**
 * Validate a team index is 0 or 1.
 */
function isValidTeamIndex(idx) {
  return idx === 0 || idx === 1;
}

/**
 * Validate difficulty string.
 */
function isValidDifficulty(d) {
  return d === 'easy' || d === 'medium' || d === 'hard';
}

/**
 * Escape a string for safe insertion into HTML.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

module.exports = {
  sanitizeName,
  isValidRoomId,
  isValidCardId,
  isValidSeatIndex,
  isValidTeamIndex,
  isValidDifficulty,
  escapeHtml,
  VALID_RANKS,
  VALID_SUITS,
};
