/**
 * dpth — Error Classes
 * 
 * Custom errors with codes for programmatic handling.
 * Every error includes a descriptive message explaining what went wrong
 * and what to do about it.
 */

export class DpthError extends Error {
  public readonly code: string;
  
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DpthError';
    this.code = code;
  }
}

/**
 * Thrown when required arguments are missing or invalid.
 */
export class ValidationError extends DpthError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'ValidationError';
  }
}

/**
 * Thrown when an entity is not found.
 */
export class EntityNotFoundError extends DpthError {
  public readonly entityId: string;
  
  constructor(entityId: string) {
    super('ENTITY_NOT_FOUND', `Entity '${entityId}' not found`);
    this.name = 'EntityNotFoundError';
    this.entityId = entityId;
  }
}

/**
 * Thrown when a storage operation fails.
 */
export class StorageError extends DpthError {
  constructor(message: string) {
    super('STORAGE_ERROR', message);
    this.name = 'StorageError';
  }
}

/**
 * Thrown when insufficient data exists for an operation.
 */
export class InsufficientDataError extends DpthError {
  constructor(message: string) {
    super('INSUFFICIENT_DATA', message);
    this.name = 'InsufficientDataError';
  }
}

/**
 * Thrown when a feature requires a capability the current adapter doesn't support.
 */
export class AdapterCapabilityError extends DpthError {
  constructor(feature: string, requirement: string) {
    super('ADAPTER_CAPABILITY', `${feature} requires ${requirement}`);
    this.name = 'AdapterCapabilityError';
  }
}
