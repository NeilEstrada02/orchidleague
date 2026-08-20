import { redisClient } from './redis.js';

const KEY = 'orchid:users';

async function loadUsers() {
  const raw = await redisClient.get(KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveUsers(users) {
  await redisClient.set(KEY, JSON.stringify(users));
}

export async function recordLogin(user) {
  const users = await loadUsers();
  const now = new Date().toISOString();
  const existing = users[user.id];
  users[user.id] = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    firstLogin: existing?.firstLogin ?? now,
    lastLogin: now,
    loginCount: (existing?.loginCount ?? 0) + 1,
    enrolled: existing?.enrolled ?? false,
    enrolledAt: existing?.enrolledAt ?? null,
    isCaptain: existing?.isCaptain ?? false,
    isAdmin: existing?.isAdmin ?? false,
    decklist: existing?.decklist ?? '',
  };
  await saveUsers(users);
}

export async function getAllUsers() {
  return Object.values(await loadUsers());
}

export async function getUser(id) {
  const users = await loadUsers();
  return users[id] ?? null;
}

export async function setEnrollment(id, enrolled) {
  const users = await loadUsers();
  const existing = users[id];
  if (!existing) return null;
  existing.enrolled = enrolled;
  existing.enrolledAt = enrolled ? (existing.enrolledAt ?? new Date().toISOString()) : null;
  if (!enrolled) existing.isCaptain = false;
  await saveUsers(users);
  return existing;
}

export async function getEnrolledUsers() {
  const users = await loadUsers();
  return Object.values(users)
    .filter((u) => u.enrolled)
    .sort((a, b) => new Date(a.enrolledAt) - new Date(b.enrolledAt));
}

export async function setCaptain(id, isCaptain) {
  const users = await loadUsers();
  const existing = users[id];
  if (!existing) return null;
  existing.isCaptain = isCaptain;
  await saveUsers(users);
  return existing;
}

export async function setAdmin(id, isAdmin) {
  const users = await loadUsers();
  const existing = users[id];
  if (!existing) return null;
  existing.isAdmin = isAdmin;
  await saveUsers(users);
  return existing;
}

export async function setDecklist(id, text) {
  const users = await loadUsers();
  const existing = users[id];
  if (!existing) return null;
  existing.decklist = text;
  await saveUsers(users);
  return existing;
}
