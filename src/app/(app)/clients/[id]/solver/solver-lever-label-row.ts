/**
 * The line above a Goals lever's stepper: its name, plus a Solve pill where the
 * lever has one. Nothing else belongs here — the calendar year sits below the
 * value, because at the 320px pane floor a name, a Solve pill and a year on one
 * line squeeze the name down to an ellipsis.
 *
 * Retirement Ages and Life Expectancy sit in the same `grid-cols-2` row, so
 * their steppers only line up if these lines are the same height. `min-h-7` is
 * the height of the Solve pill that Retirement Ages carries and Life Expectancy
 * has no counterpart for; keeping the line un-wrapped (the name truncates
 * instead) is what stops a long name pushing one column's stepper below its
 * neighbour's.
 */
export const LABEL_ROW = "mb-1.5 flex min-h-7 items-center gap-x-1.5";
