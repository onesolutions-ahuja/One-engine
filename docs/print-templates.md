# Print Templates

## Paper size = the size you design

A Print Template prints at exactly its designed canvas size. Nothing is scaled to fit.

| Paper | Design the canvas at (printable width) |
|---|---|
| 80 mm receipt roll | 72 mm = **272 px** wide (or less) |
| 58 mm receipt roll | 48 mm = **181 px** wide (or less) |
| A4 | 794 × 1123 px |

- Templates up to 400 px wide are **receipts**: one continuous page, as long as the receipt.
- Wider templates are **sheets** (A4 and similar): pages of the designed height. Longer content
  runs onto more pages.

## Item lines: Smart Line Items

Use **Smart Line Items** (Data category) for the item lines, not Smart Cart or Smart Table.

1. Place it under the heading at about the height of two rows.
2. Set **Items source** (for example the sale's cart lines).
3. Set **Item text** (`@Quantity & " x " & @Name`) and **Amount (right)**. Optionally set
   **Second line** (modifiers or notes) and **Extra line text / amount** (a discount). Lines with
   nothing in them are hidden.
4. Put the totals, payment and "Thank you" text **below** it, not beside it.

When printing, the list grows to fit every item and everything below it moves down. With
1 item the receipt is short; with 100 items it is long. Nothing overlaps.

## PRINT(template, record)

One click prints:

- **Receipt Printer in Setup → Named Devices** (USB, Serial, Bluetooth or Network/CloudPRNT):
  receipt-size templates print straight away, with no preview and no print window.
- **No printer** (or an A4 template, or the printer can't be reached): the browser's print
  window opens directly with the right paper size and no margins, header or footer.
  Chrome always shows this window. To print silently on a till, start Chrome with
  `--kiosk-printing`.

On Windows, Chrome often can't reach a USB printer that has its Windows driver installed.
Network or Bluetooth printers don't have this problem; otherwise PRINT falls back to the print
window.

`CREATEPDF` uses the same designed size.
