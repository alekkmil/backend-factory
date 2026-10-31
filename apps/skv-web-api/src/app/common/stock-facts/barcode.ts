export function isGenuineBarcode(value: string): boolean {
  return value.length > 0 &&
    !/^0+$/.test(value) &&
    !/^(?:n\/?a|unknown|placeholder|test|sample|dummy)/i.test(value);
}
