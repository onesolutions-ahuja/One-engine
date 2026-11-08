/** Starter Fields for the 12 Standard Objects. Metadata only; no records. */
export const FRESH_STANDARD_FIELDS = {
  "Invoice": [
    {
      "apiName": "Status",
      "label": "Status",
      "dataType": "text",
      "maxLength": 40
    },
    {
      "apiName": "DueDate",
      "label": "Due Date",
      "dataType": "date"
    },
    {
      "apiName": "Subtotal",
      "label": "Subtotal",
      "dataType": "number"
    },
    {
      "apiName": "TaxAmount",
      "label": "Tax Amount",
      "dataType": "number"
    },
    {
      "apiName": "DiscountAmount",
      "label": "Discount Amount",
      "dataType": "number"
    },
    {
      "apiName": "CurrencyCode",
      "label": "Currency Code",
      "dataType": "text",
      "maxLength": 3
    },
    {
      "apiName": "Notes",
      "label": "Notes",
      "dataType": "text",
      "maxLength": 2000
    }
  ],
  "InvoiceLine": [
    {
      "apiName": "Description",
      "label": "Description",
      "dataType": "text",
      "maxLength": 500
    },
    {
      "apiName": "DiscountAmount",
      "label": "Discount Amount",
      "dataType": "number"
    },
    {
      "apiName": "TaxAmount",
      "label": "Tax Amount",
      "dataType": "number"
    },
    {
      "apiName": "LineTotal",
      "label": "Line Total",
      "dataType": "number"
    }
  ],
  "Product": [
    {
      "apiName": "Description",
      "label": "Description",
      "dataType": "text",
      "maxLength": 2000
    },
    {
      "apiName": "Barcode",
      "label": "Barcode",
      "dataType": "text",
      "maxLength": 80
    },
    {
      "apiName": "Cost",
      "label": "Cost",
      "dataType": "number"
    },
    {
      "apiName": "UnitOfMeasure",
      "label": "Unit Of Measure",
      "dataType": "text",
      "maxLength": 30
    },
    {
      "apiName": "TaxCategory",
      "label": "Tax Category",
      "dataType": "text",
      "maxLength": 60
    }
  ],
  "ProductLine": [
    {
      "apiName": "UnitPrice",
      "label": "Unit Price",
      "dataType": "number"
    },
    {
      "apiName": "LineTotal",
      "label": "Line Total",
      "dataType": "number"
    }
  ],
  "Contact": [
    {
      "apiName": "FirstName",
      "label": "First Name",
      "dataType": "text",
      "maxLength": 100
    },
    {
      "apiName": "LastName",
      "label": "Last Name",
      "dataType": "text",
      "maxLength": 100
    },
    {
      "apiName": "Mobile",
      "label": "Mobile",
      "dataType": "text",
      "maxLength": 40
    },
    {
      "apiName": "JobTitle",
      "label": "Job Title",
      "dataType": "text",
      "maxLength": 100
    },
    {
      "apiName": "Customer",
      "label": "Customer",
      "dataType": "reference",
      "relatedObject": "Customer"
    }
  ],
  "Customer": [
    {
      "apiName": "CustomerNumber",
      "label": "Customer Number",
      "dataType": "text",
      "maxLength": 80
    },
    {
      "apiName": "BillingAddress",
      "label": "Billing Address",
      "dataType": "text",
      "maxLength": 1000
    },
    {
      "apiName": "ShippingAddress",
      "label": "Shipping Address",
      "dataType": "text",
      "maxLength": 1000
    },
    {
      "apiName": "Active",
      "label": "Active",
      "dataType": "boolean"
    },
    {
      "apiName": "Account",
      "label": "Account",
      "dataType": "reference",
      "relatedObject": "Account"
    }
  ],
  "Vendor": [
    {
      "apiName": "VendorNumber",
      "label": "Vendor Number",
      "dataType": "text",
      "maxLength": 80
    },
    {
      "apiName": "Address",
      "label": "Address",
      "dataType": "text",
      "maxLength": 1000
    },
    {
      "apiName": "Active",
      "label": "Active",
      "dataType": "boolean"
    },
    {
      "apiName": "Account",
      "label": "Account",
      "dataType": "reference",
      "relatedObject": "Account"
    }
  ],
  "Purchase": [
    {
      "apiName": "Status",
      "label": "Status",
      "dataType": "text",
      "maxLength": 40
    },
    {
      "apiName": "ExpectedDate",
      "label": "Expected Date",
      "dataType": "date"
    },
    {
      "apiName": "Subtotal",
      "label": "Subtotal",
      "dataType": "number"
    },
    {
      "apiName": "TaxAmount",
      "label": "Tax Amount",
      "dataType": "number"
    },
    {
      "apiName": "CurrencyCode",
      "label": "Currency Code",
      "dataType": "text",
      "maxLength": 3
    }
  ],
  "PurchaseLine": [
    {
      "apiName": "UnitPrice",
      "label": "Unit Price",
      "dataType": "number"
    },
    {
      "apiName": "TaxAmount",
      "label": "Tax Amount",
      "dataType": "number"
    },
    {
      "apiName": "LineTotal",
      "label": "Line Total",
      "dataType": "number"
    }
  ],
  "Account": [
    {
      "apiName": "AccountNumber",
      "label": "Account Number",
      "dataType": "text",
      "maxLength": 80
    },
    {
      "apiName": "Email",
      "label": "Email",
      "dataType": "text",
      "maxLength": 254
    },
    {
      "apiName": "Industry",
      "label": "Industry",
      "dataType": "text",
      "maxLength": 100
    },
    {
      "apiName": "Address",
      "label": "Address",
      "dataType": "text",
      "maxLength": 1000
    }
  ],
  "Lead": [
    {
      "apiName": "FirstName",
      "label": "First Name",
      "dataType": "text",
      "maxLength": 100
    },
    {
      "apiName": "LastName",
      "label": "Last Name",
      "dataType": "text",
      "maxLength": 100
    },
    {
      "apiName": "Phone",
      "label": "Phone",
      "dataType": "text",
      "maxLength": 40
    },
    {
      "apiName": "Company",
      "label": "Company",
      "dataType": "text",
      "maxLength": 150
    },
    {
      "apiName": "Source",
      "label": "Source",
      "dataType": "text",
      "maxLength": 80
    },
    {
      "apiName": "Description",
      "label": "Description",
      "dataType": "text",
      "maxLength": 2000
    }
  ],
  "Case": [
    {
      "apiName": "CaseNumber",
      "label": "Case Number",
      "dataType": "text",
      "maxLength": 80
    },
    {
      "apiName": "Description",
      "label": "Description",
      "dataType": "text",
      "maxLength": 2000
    },
    {
      "apiName": "Priority",
      "label": "Priority",
      "dataType": "text",
      "maxLength": 30
    },
    {
      "apiName": "Customer",
      "label": "Customer",
      "dataType": "reference",
      "relatedObject": "Customer"
    },
    {
      "apiName": "OpenedAt",
      "label": "Opened At",
      "dataType": "datetime"
    },
    {
      "apiName": "ClosedAt",
      "label": "Closed At",
      "dataType": "datetime"
    }
  ]
} as const;
