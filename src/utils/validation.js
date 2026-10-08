export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidEmail(email) {
  if (!isNonEmptyString(email)) {
    return false;
  }

  const cleanEmail = email.trim();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);
}

export function isValidPassword(password) {
  return (
    typeof password === 'string' &&
    password.length >= 6
  );
}

export function isValidUuid(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

export function isValidDate(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
}

export function isAdult(birthDate) {
  if (!isValidDate(birthDate)) {
    return false;
  }

  const birth = new Date(birthDate);
  const today = new Date();

  let age = today.getFullYear() - birth.getFullYear();

  const monthDifference =
    today.getMonth() - birth.getMonth();

  if (
    monthDifference < 0 ||
    (monthDifference === 0 &&
      today.getDate() < birth.getDate())
  ) {
    age--;
  }

  return age >= 18;
}

export function cleanString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

export function cleanStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  ];
}

export function isValidIdArray(value) {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((id) => isValidUuid(id));
}
