// App-owned common UNE property definitions.
export const commonProperties = [
  {
    "propertyKey": "size",
    "label": "Size",
    "kind": "SELECT",
    "displayOrder": 20,
    "defaultValue": "medium",
    "choices": [
      {
        "key": "small",
        "label": "Small"
      },
      {
        "key": "medium",
        "label": "Medium"
      },
      {
        "key": "large",
        "label": "Large"
      }
    ]
  },
  {
    "propertyKey": "accentColor",
    "label": "Accent colour",
    "kind": "COLOR",
    "displayOrder": 30,
    "defaultValue": "#1d4ed8"
  },
  {
    "propertyKey": "backgroundColor",
    "label": "Background colour",
    "kind": "COLOR",
    "displayOrder": 40,
    "defaultValue": ""
  },
  {
    "propertyKey": "textColor",
    "label": "Text colour",
    "kind": "COLOR",
    "displayOrder": 50,
    "defaultValue": ""
  },
  {
    "propertyKey": "borderColor",
    "label": "Border colour",
    "kind": "COLOR",
    "displayOrder": 60,
    "defaultValue": ""
  },
  {
    "propertyKey": "radius",
    "label": "Corner radius",
    "kind": "NUMBER",
    "displayOrder": 70,
    "defaultValue": 16
  },
  {
    "propertyKey": "padding",
    "label": "Padding",
    "kind": "NUMBER",
    "displayOrder": 80,
    "defaultValue": 16
  },
  {
    "propertyKey": "gap",
    "label": "Spacing",
    "kind": "NUMBER",
    "displayOrder": 90,
    "defaultValue": 12
  },
  {
    "propertyKey": "shadow",
    "label": "Shadow",
    "kind": "SELECT",
    "displayOrder": 100,
    "defaultValue": "medium",
    "choices": [
      {
        "key": "none",
        "label": "None"
      },
      {
        "key": "small",
        "label": "Small"
      },
      {
        "key": "medium",
        "label": "Medium"
      },
      {
        "key": "large",
        "label": "Large"
      }
    ]
  },
  {
    "propertyKey": "glassBlur",
    "label": "Glass blur",
    "kind": "NUMBER",
    "displayOrder": 110,
    "defaultValue": 8
  },
  {
    "propertyKey": "opacity",
    "label": "Opacity percentage",
    "kind": "NUMBER",
    "displayOrder": 120,
    "defaultValue": 100
  },
  {
    "propertyKey": "width",
    "label": "Width",
    "kind": "TEXT",
    "displayOrder": 130,
    "defaultValue": "100%"
  },
  {
    "propertyKey": "height",
    "label": "Height",
    "kind": "TEXT",
    "displayOrder": 140,
    "defaultValue": "auto"
  },
  {
    "propertyKey": "align",
    "label": "Alignment",
    "kind": "SELECT",
    "displayOrder": 150,
    "defaultValue": "start",
    "choices": [
      {
        "key": "start",
        "label": "Start"
      },
      {
        "key": "center",
        "label": "Center"
      },
      {
        "key": "end",
        "label": "End"
      },
      {
        "key": "stretch",
        "label": "Stretch"
      }
    ]
  },
  {
    "propertyKey": "desktopColumns",
    "label": "Desktop columns",
    "kind": "NUMBER",
    "displayOrder": 160,
    "defaultValue": 3
  },
  {
    "propertyKey": "tabletColumns",
    "label": "Tablet columns",
    "kind": "NUMBER",
    "displayOrder": 170,
    "defaultValue": 2
  },
  {
    "propertyKey": "mobileColumns",
    "label": "Mobile columns",
    "kind": "NUMBER",
    "displayOrder": 180,
    "defaultValue": 1
  },
  {
    "propertyKey": "objectApiName",
    "label": "Bound object",
    "kind": "TEXT",
    "displayOrder": 200,
    "defaultValue": ""
  },
  {
    "propertyKey": "fieldApiName",
    "label": "Bound field",
    "kind": "OBJECT_FIELD",
    "displayOrder": 210,
    "defaultValue": ""
  },
  {
    "propertyKey": "actionFlowApiName",
    "label": "Action Flow",
    "kind": "FLOW",
    "displayOrder": 220,
    "defaultValue": ""
  },
  {
    "propertyKey": "fontFamily",
    "label": "Font family",
    "kind": "SELECT",
    "displayOrder": 230,
    "choices": [
      {
        "key": "system",
        "label": "system"
      },
      {
        "key": "sans",
        "label": "sans"
      },
      {
        "key": "serif",
        "label": "serif"
      },
      {
        "key": "mono",
        "label": "mono"
      }
    ]
  },
  {
    "propertyKey": "fontSize",
    "label": "Font size (px)",
    "kind": "NUMBER",
    "displayOrder": 235
  },
  {
    "propertyKey": "fontWeight",
    "label": "Font weight",
    "kind": "SELECT",
    "displayOrder": 240,
    "choices": [
      {
        "key": "400",
        "label": "400"
      },
      {
        "key": "500",
        "label": "500"
      },
      {
        "key": "600",
        "label": "600"
      },
      {
        "key": "700",
        "label": "700"
      },
      {
        "key": "800",
        "label": "800"
      }
    ]
  },
  {
    "propertyKey": "lineHeight",
    "label": "Line height (ratio)",
    "kind": "NUMBER",
    "displayOrder": 245
  },
  {
    "propertyKey": "letterSpacing",
    "label": "Letter spacing (px)",
    "kind": "NUMBER",
    "displayOrder": 250
  },
  {
    "propertyKey": "textAlign",
    "label": "Text alignment",
    "kind": "SELECT",
    "displayOrder": 255,
    "choices": [
      {
        "key": "left",
        "label": "left"
      },
      {
        "key": "center",
        "label": "center"
      },
      {
        "key": "right",
        "label": "right"
      },
      {
        "key": "start",
        "label": "start"
      },
      {
        "key": "end",
        "label": "end"
      }
    ]
  },
  {
    "propertyKey": "margin",
    "label": "Outer margin (px)",
    "kind": "NUMBER",
    "displayOrder": 260
  },
  {
    "propertyKey": "minWidth",
    "label": "Minimum width (CSS length)",
    "kind": "TEXT",
    "displayOrder": 265
  },
  {
    "propertyKey": "maxWidth",
    "label": "Maximum width (CSS length)",
    "kind": "TEXT",
    "displayOrder": 270
  },
  {
    "propertyKey": "minHeight",
    "label": "Minimum height (CSS length)",
    "kind": "TEXT",
    "displayOrder": 275
  },
  {
    "propertyKey": "maxHeight",
    "label": "Maximum height (CSS length)",
    "kind": "TEXT",
    "displayOrder": 280
  },
  {
    "propertyKey": "borderWidth",
    "label": "Border width (px)",
    "kind": "NUMBER",
    "displayOrder": 285
  },
  {
    "propertyKey": "cardDensity",
    "label": "Card density",
    "kind": "SELECT",
    "displayOrder": 300,
    "choices": [
      {
        "key": "default",
        "label": "default"
      },
      {
        "key": "compact",
        "label": "compact"
      },
      {
        "key": "comfortable",
        "label": "comfortable"
      },
      {
        "key": "image-focused",
        "label": "image focused"
      }
    ]
  },
  {
    "propertyKey": "cardPadding",
    "label": "Card padding (px)",
    "kind": "NUMBER",
    "displayOrder": 305
  },
  {
    "propertyKey": "cardRadius",
    "label": "Card radius (px)",
    "kind": "NUMBER",
    "displayOrder": 310
  },
  {
    "propertyKey": "cardMinHeight",
    "label": "Card minimum height (px)",
    "kind": "NUMBER",
    "displayOrder": 315
  },
  {
    "propertyKey": "cardBackgroundColor",
    "label": "Card background",
    "kind": "COLOR",
    "displayOrder": 320
  },
  {
    "propertyKey": "cardBorderColor",
    "label": "Card border colour",
    "kind": "COLOR",
    "displayOrder": 325
  },
  {
    "propertyKey": "cardBorderWidth",
    "label": "Card border width (px)",
    "kind": "NUMBER",
    "displayOrder": 330
  },
  {
    "propertyKey": "cardShadow",
    "label": "Card shadow",
    "kind": "SELECT",
    "displayOrder": 335,
    "choices": [
      {
        "key": "none",
        "label": "none"
      },
      {
        "key": "small",
        "label": "small"
      },
      {
        "key": "medium",
        "label": "medium"
      },
      {
        "key": "large",
        "label": "large"
      }
    ]
  },
  {
    "propertyKey": "cardHover",
    "label": "Card hover effect",
    "kind": "SELECT",
    "displayOrder": 340,
    "choices": [
      {
        "key": "none",
        "label": "none"
      },
      {
        "key": "lift",
        "label": "lift"
      },
      {
        "key": "highlight",
        "label": "highlight"
      }
    ]
  },
  {
    "propertyKey": "imageHeight",
    "label": "Image height (px)",
    "kind": "NUMBER",
    "displayOrder": 345
  },
  {
    "propertyKey": "imageFit",
    "label": "Image fit",
    "kind": "SELECT",
    "displayOrder": 350,
    "choices": [
      {
        "key": "contain",
        "label": "contain"
      },
      {
        "key": "cover",
        "label": "cover"
      },
      {
        "key": "fill",
        "label": "fill"
      },
      {
        "key": "scale-down",
        "label": "scale down"
      }
    ]
  },
  {
    "propertyKey": "imageAspectRatio",
    "label": "Image aspect ratio",
    "kind": "SELECT",
    "displayOrder": 355,
    "choices": [
      {
        "key": "auto",
        "label": "auto"
      },
      {
        "key": "1/1",
        "label": "1/1"
      },
      {
        "key": "4/3",
        "label": "4/3"
      },
      {
        "key": "16/9",
        "label": "16/9"
      },
      {
        "key": "3/4",
        "label": "3/4"
      }
    ]
  },
  {
    "propertyKey": "showImage",
    "label": "Show card images",
    "kind": "BOOLEAN",
    "displayOrder": 360
  },
  {
    "propertyKey": "showTitle",
    "label": "Show card titles",
    "kind": "BOOLEAN",
    "displayOrder": 365
  },
  {
    "propertyKey": "showPrice",
    "label": "Show card prices",
    "kind": "BOOLEAN",
    "displayOrder": 370
  },
  {
    "propertyKey": "showAddIcon",
    "label": "Show card add icon",
    "kind": "BOOLEAN",
    "displayOrder": 375
  }
];
