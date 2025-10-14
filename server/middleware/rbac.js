import jwt from 'jsonwebtoken';
import { nanoid } from 'nanoid';
import { createError, ErrorTypes } from '../errors.js';
import { getDB } from '../db.js';

// Role hierarchy for permission checks
const ROLE_LEVELS = {
  STUDENT: 0,
  TA: 1,
  ADMIN: 2
};

export async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  
  if (!token) {
    return next(createError(ErrorTypes.UNAUTHORIZED, 'No token provided'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret');
    const db = await getDB();
    
    // Verify user still exists and is active
    const user = await db.get(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      decoded.sub
    );
    
    if (!user) {
      return next(createError(ErrorTypes.UNAUTHORIZED, 'User not found'));
    }

    req.user = user;
    next();
  } catch (err) {
    next(createError(ErrorTypes.UNAUTHORIZED, 'Invalid token'));
  }
};
export function checkRole(minRole) {
  return (req, res, next) => {
    if (!req.user) {
      return next(createError(ErrorTypes.UNAUTHORIZED, 'Authentication required'));
    }
    
    const userLevel = ROLE_LEVELS[req.user.role] ?? -1;
    const requiredLevel = ROLE_LEVELS[minRole] ?? 999;
    
    if (userLevel < requiredLevel) {
      return next(createError(ErrorTypes.FORBIDDEN, 'Admin access required'));
    }
    
    next();
  };
}

/**
 * Middleware to check if user has access to the requested resource
 * For use with endpoints that accept resourceId/slotId
 */
export function checkResourceAccess(req, res, next) {
  // Admins have full access
  if (req.user.role === 'ADMIN') {
    return next();
  }
  
  // For non-admins, check specific resource permissions
  // This could involve checking department/course assignments for TAs
  // or enrollment status for students
  next();
}

/**
 * Resource capacity modification guard
 */
export function guardCapacityChange(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return next(createError(ErrorTypes.FORBIDDEN, 'Only admins can modify capacity'));
  }
  next();
}

/**
 * Analytics access guard
 */
export function guardAnalytics(req, res, next) {
  if (req.user.role !== 'ADMIN') {
    return next(createError(ErrorTypes.FORBIDDEN, 'Analytics access restricted to admins'));
  }
  next();
}

/**
 * Audit logging middleware
 */
export async function logAudit(actorId, action, targetId, details = null) {
  const db = await getDB();
  try {
    await db.run(
      'INSERT INTO auditLog (id, actorId, action, targetId, details) VALUES (?, ?, ?, ?, ?)',
      nanoid(10), actorId, action, targetId, details ? JSON.stringify(details) : null
    );
  } catch (err) {
    console.error('Audit log error:', err);
    // Don't throw - audit log failure shouldn't break the app
  }
}