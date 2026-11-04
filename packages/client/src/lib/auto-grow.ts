/** Grows a textarea to its text, for engines without `field-sizing: content`. */
export const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el || CSS.supports("field-sizing", "content")) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
};
