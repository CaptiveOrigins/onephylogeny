# The OneOrigin suite

**Good tools for understanding where animals come from, without a subscription.**

OneOrigin is a suite of three independent tools from EXTANT APE. Each does one job well and works on its own. Use one, two or all three, in whatever combination fits your work.

| Tool | The question it answers |
| --- | --- |
| [OnePedigree](https://github.com/ExtantApe/OnePedigree) | How is this individual related to its known relatives? |
| [OneTaxonomy](https://github.com/ExtantApe/OneTaxonomy) | What do sources claim about how life is organized, and how do we browse it? |
| [OnePhylogeny](https://github.com/ExtantApe/OnePhylogeny) | Given DNA, what does the evidence support, and where does this sample fit? |

## Why this exists

Too much good work now sits behind a monthly charge. Researchers, keepers, teachers and small conservation groups shouldn't have to rent the tools they rely on, or lose their own work when a payment stops.

So the OneOrigin tools are built differently.

## What we commit to

- **No subscriptions.** The OneOrigin tools don't charge a recurring fee to use them.
- **No account needed.** The Mac apps run on your computer. They use the internet only when you ask for public data or check for updates.
- **Your files stay yours.** Everything is saved as plain, documented files you can open without us. If we vanished tomorrow, your work would still be readable.
- **Your source files aren't touched.** Your extra information lives beside them.
- **The code is open to read and improve.** Anyone can read, change and share it for noncommercial use, with attribution, under [PolyForm Noncommercial](https://polyformproject.org/licenses/noncommercial/1.0.0). A business that wants to use it commercially can ask for a separate license. This license makes the code source-available. It isn't an open source license.
- **Honesty over polish.** The tools say what they don't know and what a result can't tell you. Unknown stays unknown.

These commitments cover the tools. Services that have real ongoing costs, such as lab testing, are separate and priced as what they are.

## Separately or together

No tool needs another. Connections are optional, and they use plain files or a small optional package.

| You use | What you get | Today |
| --- | --- | --- |
| **OnePedigree alone** | Pedigrees for any species, with GEDCOM, CSV and JSON files | Mac app and npm packages |
| **OneTaxonomy alone** | Curated classifications and trees, with views and lessons | npm packages and a playground; Mac app planned |
| **OnePhylogeny alone** | Fetch records, build reference panels and test samples | Mac app and command line; npm planned |
| **OnePhylogeny + OneTaxonomy** | Trees you build become hypotheses you can check and browse | Export package works; opening it in a OneTaxonomy Mac app is planned |
| **OnePhylogeny + OnePedigree** | Check DNA results against recorded maternal lines, and report conflicts for review | Check package works; not yet in either app |
| **OnePedigree + OneTaxonomy** | Pedigrees tied to a curated species list | Planned |
| **All three** | From a species, to its lineages, to a named animal's family and DNA | Planned |
| **Any of them on a website** | Payload plugins and React views on your own site | OnePedigree and OnePhylogeny published as alphas; OneTaxonomy planned |

## One suite, each its own

The tools share a look, a way of behaving and a set of beliefs. Each keeps its own purpose, layout and color. Together they follow the [suite guidelines](guidelines.md), which turn this page into specific rules.

## Names

- **OneOrigin** is the name of the suite. It isn't a package or a product you install.
- Each tool keeps its own name, repo and app.
- Packages stay under each project's scope, such as `@extantape/onephylogeny-core`.
