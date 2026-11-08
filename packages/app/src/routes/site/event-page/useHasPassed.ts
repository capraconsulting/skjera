import { useEffect, useState } from "react";

/** Whether `at` has passed, turning true when it does; never without one. */
export const useHasPassed = (at: Date | null) => {
  const time = at?.getTime() ?? null;
  const [passed, setPassed] = useState(
    () => time !== null && time <= Date.now(),
  );
  useEffect(() => {
    if (time === null) {
      setPassed(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = () => {
      const left = time - Date.now();
      setPassed(left <= 0);
      if (left <= 0) return;
      // setTimeout takes at most about 24 days: wait again until it has passed.
      timer = setTimeout(wait, Math.min(left, 2 ** 31 - 1));
    };
    wait();
    return () => clearTimeout(timer);
  }, [time]);
  return passed;
};
