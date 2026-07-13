import { z } from 'zod';

export const ContractVersionSchema = z.literal(1);

export const EntityIdSchema = z.uuid();

export const DateTimeSchema = z.iso.datetime({ offset: true });

export const hasControlCharacters = (value: string) =>
  Array.from(value).some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint < 32 || codePoint === 127;
  });

export const CanonicalOriginSchema = z
  .url()
  .max(256)
  .refine((value) => {
    if (!URL.canParse(value)) {
      return false;
    }
    const url = new URL(value);
    return url.protocol === 'https:' && value === url.origin;
  }, 'Expected a canonical HTTPS origin');

const PathSchema = z
  .string()
  .min(1)
  .max(512)
  .startsWith('/')
  .refine((value) => !hasControlCharacters(value) && !/[\s\\?#]/.test(value), {
    message: 'Paths must be encoded and cannot contain queries or fragments',
  });

export const PagePathSchema = PathSchema;

export const PathPatternSchema = PathSchema;

export const OperationIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const hasUniqueValues = (values: readonly string[]) =>
  new Set(values).size === values.length;
