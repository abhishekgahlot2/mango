import { expect, test } from "bun:test";
import { activityRange } from "./ActivityLog";

test("activity window stays bounded while scrolling and filtering", () => {
  expect(activityRange(10_000, 0, 400)).toEqual({ start: 0, end: 15 });
  expect(activityRange(10_000, 20_000, 400)).toEqual({ start: 495, end: 515 });
  expect(activityRange(3, 20_000, 400)).toEqual({ start: 3, end: 3 });
});
