/**
 * The type a component travels under when it is dragged onto a design.
 *
 * Not `text/plain`: a browser window accepts drags from anywhere, and under a
 * generic type a file from the desktop or a selection from another tab would
 * arrive looking exactly like a component from the palette.
 *
 * It lives in `lib` because both ends of the drag are separate feature slices.
 * A constant either of them owned would make the other import across.
 */
export const KIND_MIME = "application/x-component-kind";
