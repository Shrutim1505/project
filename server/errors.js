// Error types with codes and default messages
export const ErrorTypes = {
  OVERLAP_CONFLICT: {
    code: 'OVERLAP_CONFLICT',
    message: 'Cannot book overlapping slots'
  },
  ALREADY_BOOKED: {
    code: 'ALREADY_BOOKED',
    message: 'Already booked or waitlisted for this slot'
  },
  CAPACITY_FULL: {
    code: 'CAPACITY_FULL',
    message: 'No capacity available'
  },
  PAST_SLOT: {
    code: 'PAST_SLOT',
    message: 'Cannot book slots in the past'
  },
  NOT_ALLOWED: {
    code: 'NOT_ALLOWED',
    message: 'Operation not permitted'
  },
  GRACE_PERIOD: {
    code: 'GRACE_PERIOD',
    message: 'Too close to start time'
  },
  SLOT_BLOCKED: {
    code: 'SLOT_BLOCKED',
    message: 'Slot is blocked'
  },
  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'Resource not found'
  },
  INVALID_INPUT: {
    code: 'INVALID_INPUT',
    message: 'Invalid input data'
  }
};

// Create an error instance with code and optional details
export function createError(type, details = null) {
  const error = new Error(type.message);
  error.code = type.code;
  if (details) error.details = details;
  return error;
}

// Map error codes to human-readable messages
export const ErrorMessages = {
  OVERLAP_CONFLICT: 'You already have a booking for this time',
  ALREADY_BOOKED: 'You already have a booking for this slot',
  CAPACITY_FULL: 'This slot is at full capacity',
  PAST_SLOT: 'Cannot book slots in the past',
  NOT_ALLOWED: 'You do not have permission for this action',
  GRACE_PERIOD: 'Too close to start time to make changes',
  SLOT_BLOCKED: 'This slot is blocked',
  NOT_FOUND: 'The requested resource was not found',
  INVALID_INPUT: 'Please check your input and try again'
};