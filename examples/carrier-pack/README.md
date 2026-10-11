# Example Carrier Pack

A carrier pack is the versioned set of config files a carrier's developers
keep in their own repository. A carrier stack loads it from the directory
named by `CARRIER_PACK_DIR`, so the carrier's customisations sit outside the
core image and are not touched by a release upgrade.

This example is for a carrier `acme-mutual`. Copy it as a starting point.

## Layout

| Path | Purpose |
| --- | --- |
| `pack.yaml` | Manifest: `packFormat`, `carrier` (the tenant id), `version`. |
| `config.yaml` | `enabledProducts` and `overrides` for rating, underwriting, and documents. Optional. |
| `products/<code>/coverage.yaml` | A product the carrier adds: coverages, limits, deductibles, capabilities. Same contract as `docs/PRODUCT_PACK_CONTRACT.md`. |
| `products/<code>/rates.yaml` | That product's rate and factor tables. |
| `fields/<code>.json` | Field metadata for a product (core or added): type, validation, visibility, grouping, order. Optional. |
| `tables/<name>.yaml` | A lookup or reference table: option lists, rating factors, and values for rules. Optional. |
| `screens/<code>.yaml` | The risk step for a product: sections or tabs, columns, widgets, and rules for when fields show, are required, and are valid. Optional. |

## What this example shows

- **A new product**, `condo-unit-owners`, with its own coverages and limits,
  including a `LOSS_ASSESS` coverage the framework's homeowners product does
  not have.
- **New fields** on that product: `floorLevel`, `masterPolicyDeductible`, and
  `associationName`.
- **Its own rating**, defined entirely in `rates.yaml`
  (`ratingAdapter: rate-table`): a term factor, six rating factors including
  one on the new `floorLevel` field and one on state, a pricing method per
  coverage, deductible factors, a minimum premium, fees, and tax.
- **Its own quote form**: the fields file sets each field's label, type,
  option list, help text, section, and order.
- **Which products the carrier sells** (`enabledProducts`): two core products
  plus the new one. Core products not listed are not offered.
- **A tuned core product**: different personal-auto driver age factors.

## Rules

- `carrier` must equal the stack's `CARRIER_TENANT_ID`.
- A pack adds products under new codes. It cannot replace a core product.
- `ratingAdapter: rate-table` prices the product from its own `rates.yaml`.
  `unsupported` marks a product that is not quotable yet.
- Every product in `enabledProducts` and every `fields/<code>.json` must name
  a core product or one in the pack.

## Rating a product from tables

```yaml
rating:
  basePremium: 180                # optional; needed by shareOfBase
  termFactors: { 6: 0.55, 12: 1 } # optional, by term in months
  factors:                        # multiplied together
    - name: Construction
      field: construction         # a field on the risk
      table: { frame: 1.05, masonry: 0.90 }
      default: 1                  # used when no entry matches
    - name: Protection class
      field: protectionClass
      ranges: { '1-4': 0.92, '5-8': 1.00, '9-10': 1.20 }
    - name: State
      path: state                 # anywhere on the quote
      table: { TX: 1.10 }
  coverages:                      # one pricing method per coverage
    A: { rate: 1.35, ratePer: 1000 }           # per 1,000 of limit
    E: { byLimit: { 100000: 40, 300000: 55 } } # premium per limit option
    F: { flat: 12, applyFactors: false }       # fixed amount, no factors
    default: { shareOfBase: 0.05 }             # anything not listed
  minimumPremium: 150
fees: { policy: 25 }
taxes: { rate: 0.02 }
```

- Bands are written `1-4`, `9+`, `<25`, `<=10`, `>5`, or `>=65`.
- A factor with no matching entry uses its `default`, or 1. Add
  `required: true` to reject the quote instead.
- A coverage can carry `deductibleFactors`, keyed by deductible.
- A coverage whose limit is a percent of another coverage is rated on the
  resulting amount.
- Every quote records the factors and methods used in its calculation trace.
- A rating workbook published for the product in the rating workbench takes
  over from these tables, as it does for core products.

## Coverages and the quote form

- A coverage with `limits` or `percentOptions` gets a drop-down. A coverage
  with `limitType: value` gets a free-form amount, starting from
  `defaultLimit`. A coverage's own `deductibles` list gets a drop-down.
- `fields/<code>.json` drives the risk step: `label`, `type` (`string`,
  `int`, `number`, `bool`, `enum`, `date`), `enum` options, `required`,
  `help`, and `ui.group` / `ui.order` for sections and ordering.
- Before the product can be quoted it needs, in the admin screens, an
  underwriting company that writes it and a state eligibility record.

## Lookup tables

A table is a file under `tables/` with named columns and one key column:

```yaml
table: roof-types
key: code                       # the column that identifies a row
columns: [code, name, factor]
rows:
  - [asphalt, Asphalt shingle, 1.00]
  - { code: metal, name: Standing-seam metal, factor: 0.94 }
```

It can be used in three places:

- **Option list for a field** (`fields/<code>.json`):
  `"optionsFrom": {"table": "roof-types", "value": "code", "label": "name"}`.
  The value is stored; the label is shown.
- **Rating factor** (`rates.yaml`): `fromTable: roof-types` with
  `value: factor`. The field's value is matched on the table's key column.
- **Rule** (`screens/<code>.yaml`):
  `lookup('schedule-limits', quote.state, 'scheduleMax')`. A missing table,
  row, or column gives an empty value, so guard with `isSet(...)`.

Tables a screen's rules read are sent to the browser with the screen, so keep
those small. Tables used only for rating or option lists are not sent.

## Lists of items on a risk

A field of type `list` holds repeating items, such as scheduled valuables,
additional locations, or drivers. Its columns are defined with it:

```json
{"path": "risks.0.scheduledItems", "label": "Scheduled Items", "type": "list", "maxItems": 20,
 "item": [
   {"key": "description", "label": "Description", "type": "string", "required": true},
   {"key": "category", "label": "Category", "type": "enum", "enum": ["jewelry", "art"]},
   {"key": "value", "label": "Insured Value", "type": "number", "required": true}
 ]}
```

- **On screen** it is a grid with one row per item and Add and Remove
  buttons. `minItems` and `maxItems` bound its size; `requiredWhen` makes at
  least one item necessary.
- **Rules** can check every item (`each: scheduledItems`, with `item.<column>`
  in the rule) or the whole list (`count(risk.scheduledItems)`,
  `sum(risk.scheduledItems, 'value')`).
- **Rating** can price a coverage per item:

```yaml
SCHEDULED:
  perItem:
    list: scheduledItems
    amount: value        # item column holding the insured amount
    rate: 1.20
    ratePer: 100
    factors:             # read from the item
      - { name: Category, field: category, table: { jewelry: 1.50 }, default: 1 }
```

Items are stored with the policy, so they are versioned, endorsed, and
renewed like the rest of the risk.

## Designing the risk screen

`screens/<code>.yaml` lays out the fields from `fields/<code>.json`. Without
it, a product's fields are shown in one section per `ui.group`.

```yaml
product: condo-unit-owners
risk:
  layout: tabs                  # or sections (stacked, the default)
  sections:
    - title: Unit
      columns: 3                # 1 to 4
      help: Shown under the section title.
      visibleWhen: quote.state != 'FL'      # hide a whole section
      fields:
        - floorLevel                         # a field by name
        - field: address
          span: 2                            # columns the field takes
          placeholder: Street and unit
        - field: occupancy
          widget: radio
        - field: monthlyRent
          widget: currency
          visibleWhen: risk.occupancy == 'TenantOccupied'
          requiredWhen: risk.occupancy == 'TenantOccupied'
  validations:
    - rule: risk.floorLevel <= risk.buildingFloors    # must be true
      when: isSet(risk.buildingFloors)                # only checked while this holds
      field: floorLevel                               # omit for a whole-step message
      message: Floor level cannot be higher than the building
```

| Field type | Widgets (first is the default) |
| --- | --- |
| `string` | `text`, `textarea` |
| `int`, `number` | `number`, `currency` |
| `enum` | `select`, `radio` |
| `bool` | `checkbox`, `select`, `radio` |
| `date` | `date` |

A field entry can also set `label`, `help`, and `readOnly: true`.

Rules are expressions over the quote:

- **Names:** `risk.<field>`, `quote.state`, `quote.termMonths`,
  `quote.effectiveDate`, `quote.productCode`, `applicant.<field>`, and
  `coverages.<CODE>.selected`, `.limit`, `.deductible`, `.percent`.
- **Operators:** `||`, `&&`, `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `in [...]`,
  `not in [...]`, `+`, `-`, `*`, `/`, and parentheses.
- **Functions:** `isSet`, `isEmpty`, `len`, `min`, `max`, `abs`, `round`,
  `lower`, `upper`, `contains`, `startsWith`, `number`.
- A name with no value is empty, never an error. `'true'`/`'false'` and
  numeric text from form controls compare as booleans and numbers.

Behaviour to rely on:

- The API applies the same rules on every transaction that creates or changes
  risk data: quote, bind, endorsement (preview and execution), renewal, and
  rewrite. They cannot be skipped by calling the API directly.
- A cancellation or reinstatement that leaves the risk data as it was is
  never blocked by these rules. One that also changes the risk data must meet
  them.
- A hidden field is never required and its rules do not apply. A value left
  in a field that later becomes hidden is kept but ignored.
- For a **core product**, the screen file adds sections under the built-in
  screen. It may only place fields the pack defines in `fields/<code>.json`
  that the built-in screen does not already show.

## Changing a pack while policies are in force

Each policy term is pinned to the product as it was defined when the term
started: rates, coverages, screen rules, and any published rating workbook.

- A **new quote**, a **renewal**, and a **rewrite** use the pack as it is now.
- An **endorsement**, **cancellation**, or **reinstatement** uses the version
  the term was written on. A new rate table does not change a mid-term
  endorsement premium, and a new rule does not reach back into a term already
  in force.
- At **renewal** the policy must meet the current rules, so a rule added
  mid-term can stop a renewal until the data is corrected.
- The wizard shows a mid-term transaction the screen from the pinned version.
- Every premium records the product version that priced it.

Bump `version` in `pack.yaml` whenever the pack changes, so the version on a
policy tells you which pack it was written on.

## Checking a pack

```bash
# From a checkout
npm run validate:pack --workspace=server -- ../examples/carrier-pack

# With a release image, for example before taking that release
docker run --rm -v "$PWD/my-pack:/carrier-pack:ro" <api-image>:<version> \
  node server/dist/validateCarrierPack.js /carrier-pack
```

The command exits non-zero and lists each problem with the file it is in. A
stack started with `CARRIER_PACK_DIR` runs the same check and refuses to
start on an invalid pack.

## Not in the pack format yet

Standalone business tables (records with their own screens, not tied to a
policy), more than one risk per policy, coverage triggers, rating workbooks,
form templates, screens for steps other than the risk step, and layering a
carrier product over a core product are planned additions to the format.
