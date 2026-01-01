// Form validation utilities with real-time feedback
import { useState, useCallback } from 'react';

export interface ValidationRule {
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  custom?: (value: any) => string | null;
}

export interface ValidationErrors {
  [key: string]: string;
}

export function useFormValidation<T extends Record<string, any>>(
  initialValues: T,
  rules: Record<keyof T, ValidationRule>
) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<keyof T, boolean>>(
    {} as Record<keyof T, boolean>
  );

  const validate = useCallback(
    (fieldName: keyof T, value: any): string | null => {
      const rule = rules[fieldName];
      if (!rule) return null;

      if (rule.required && (!value || (typeof value === 'string' && !value.trim()))) {
        return `${String(fieldName)} is required`;
      }

      if (value) {
        if (rule.min !== undefined && value.length < rule.min) {
          return `${String(fieldName)} must be at least ${rule.min} characters`;
        }

        if (rule.max !== undefined && value.length > rule.max) {
          return `${String(fieldName)} must be at most ${rule.max} characters`;
        }

        if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
          return `${String(fieldName)} format is invalid`;
        }

        if (rule.custom) {
          return rule.custom(value);
        }
      }

      return null;
    },
    [rules]
  );

  const handleChange = useCallback(
    (fieldName: keyof T, value: any) => {
      setValues((prev) => ({ ...prev, [fieldName]: value }));
      
      // Real-time validation if field has been touched
      if (touched[fieldName]) {
        const error = validate(fieldName, value);
        setErrors((prev) => {
          if (error) {
            return { ...prev, [fieldName]: error };
          } else {
            const { [fieldName]: _, ...rest } = prev;
            return rest;
          }
        });
      }
    },
    [touched, validate]
  );

  const handleBlur = useCallback(
    (fieldName: keyof T) => {
      setTouched((prev) => ({ ...prev, [fieldName]: true }));
      const error = validate(fieldName, values[fieldName]);
      setErrors((prev) => {
        if (error) {
          return { ...prev, [fieldName]: error };
        } else {
          const { [fieldName]: _, ...rest } = prev;
          return rest;
        }
      });
    },
    [values, validate]
  );

  const validateAll = useCallback((): boolean => {
    const newErrors: ValidationErrors = {};
    let isValid = true;

    (Object.keys(rules) as Array<keyof T>).forEach((fieldName) => {
      const error = validate(fieldName, values[fieldName]);
      if (error) {
        newErrors[fieldName as string] = error;
        isValid = false;
      }
    });

    setErrors(newErrors);
    setTouched(
      Object.keys(rules).reduce(
        (acc, key) => ({ ...acc, [key]: true }),
        {} as Record<keyof T, boolean>
      )
    );

    return isValid;
  }, [values, rules, validate]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({} as Record<keyof T, boolean>);
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    handleChange,
    handleBlur,
    validateAll,
    reset,
    setValues,
  };
}

