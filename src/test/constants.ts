/**
 * Constants for mint/burn config property names
 * These can be used across tests to avoid string literals and improve type safety
 */
export const CONFIG_PROPERTIES = {
  FIXED_AMOUNT: 'fixedAmount',
  RANGED_AMOUNT: 'rangedAmount',
  UNAUTHORIZED: 'unauthorized',
} as const;

/**
 * Constants for mint/burn params property names
 */
export const PARAMS_PROPERTIES = {
  FIXED_AMOUNT: 'fixedAmount',
  MIN_AMOUNT: 'minAmount',
  MAX_AMOUNT: 'maxAmount',
} as const;

/**
 * Type definitions for better type safety
 */
export type ConfigProperty =
  (typeof CONFIG_PROPERTIES)[keyof typeof CONFIG_PROPERTIES];
export type ParamsProperty =
  (typeof PARAMS_PROPERTIES)[keyof typeof PARAMS_PROPERTIES];

/**
 * All available config properties as a typed array
 * Useful for iteration or validation
 */
export const ALL_CONFIG_PROPERTIES = Object.values(
  CONFIG_PROPERTIES
) as ConfigProperty[];

/**
 * All available params properties as a typed array
 * Useful for iteration or validation
 */
export const ALL_PARAMS_PROPERTIES = Object.values(
  PARAMS_PROPERTIES
) as ParamsProperty[];

/**
 * Test-specific error messages that are not part of the core token standard
 * These include framework errors, proof system errors, and test-specific scenarios
 */
export const TEST_ERROR_MESSAGES = {
  INVALID_SIGNATURE_FEE_PAYER:
    'Check signature: Invalid signature on fee payer for key',
  INVALID_SIGNATURE_ACCOUNT_UPDATE:
    'Check signature: Invalid signature on account_update 2',
  CONSTRAINT_UNSATISFIED: 'Constraint unsatisfied (unreduced)',
  PAUSED_METHOD: 'The `approveCustom` method is paused!',
  NO_ADMIN_KEY: 'Unable to fetch admin contract key',
  NO_AUTHORIZATION_PROVIDED:
    'the required authorization was not provided or is invalid',
} as const;
