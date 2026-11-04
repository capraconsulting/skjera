import { m } from "@skjera/i18n/messages";
import { dialogStyles } from "../../components/Dialog.tsx";
import inputStyles from "../../components/Input.module.css";
import { Input } from "../../components/Input.tsx";
import styles from "./RichTextToolbar.module.css";
import { type ImageChoices, imagePlacements, imageSizes } from "./richText.ts";

const placementNames: Record<ImageChoices["placement"], () => string> = {
  full: () => m.editor_placement_full(),
  left: () => m.editor_placement_left(),
  right: () => m.editor_placement_right(),
  center: () => m.editor_placement_center(),
};

const sizeNames: Record<ImageChoices["size"], () => string> = {
  small: () => m.editor_size_small(),
  medium: () => m.editor_size_medium(),
  large: () => m.editor_size_large(),
};

/** The caption, placement and size of an image, as fields of a form. */
export function ImageChoiceFields(props: { readonly choices: ImageChoices }) {
  const { choices } = props;
  const select = `${inputStyles.input} ${dialogStyles.input} ${styles.description}`;
  return (
    <>
      <Input
        name="caption"
        aria-label={m.editor_caption()}
        className={`${dialogStyles.input} ${styles.description}`}
        defaultValue={choices.caption}
      />
      <select
        name="placement"
        aria-label={m.editor_placement()}
        className={select}
        defaultValue={choices.placement}
      >
        {imagePlacements.map((each) => (
          <option key={each} value={each}>
            {placementNames[each]()}
          </option>
        ))}
      </select>
      <select
        name="size"
        aria-label={m.editor_size()}
        className={select}
        defaultValue={choices.size}
      >
        {imageSizes.map((each) => (
          <option key={each} value={each}>
            {sizeNames[each]()}
          </option>
        ))}
      </select>
    </>
  );
}

/** The choices a form with `ImageChoiceFields` was submitted with. */
export const readChoices = (form: FormData): ImageChoices => {
  const placement = String(form.get("placement"));
  const size = String(form.get("size"));
  return {
    placement: imagePlacements.find((each) => each === placement) ?? "full",
    size: imageSizes.find((each) => each === size) ?? "medium",
    caption: String(form.get("caption") ?? "").trim(),
  };
};
