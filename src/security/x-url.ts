import { parseEligibleXUrl } from './active-x-tab';

export function isEligibleXUrl(value: string | undefined): boolean {
  return parseEligibleXUrl(value) !== undefined;
}
