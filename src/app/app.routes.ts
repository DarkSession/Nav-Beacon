import { Routes } from '@angular/router';

/**
 * The application's routes.
 *
 * Five screens, each addressable by what it is about: the product's own address
 * by the product, hull detail by the hull's own name, the two benches by the
 * work done at them — `/outfitting` a ship, `/equipment` a Commander.
 *
 * The saved builds are not among them. They are a layer over the screen a
 * Commander is on and nothing else — no address, no history entry of its own,
 * no document of its own to crawl (Commander request 2026-09-04). The
 * routes-and-ui contract asks that a *surface* be addressable, and the library
 * is not one: it is a list of records held on this device, which no address off
 * this device could resolve and no crawler could read. What it opens — a build
 * — has an address, and that is where a Commander lands.
 *
 * `title` and `data.description` are message keys rather than phrases:
 * `RouteTitleStrategy` resolves both in the committed locale, so the document
 * title and the sentence a search result quotes change language with everything
 * else rather than one navigation later (011/FR-027). A route that declares no
 * description inherits the nearest ancestor's — and so does one whose key names
 * a subject the route cannot resolve, which is what makes a hull address no
 * hull answers to read as the catalogue rather than as a blank.
 *
 * No route carries build data in its path or query. The only build payload in
 * a URL is the `/outfitting` fragment (FR-015).
 */
export const routes: Routes = [
  {
    // The product's own address. It is a screen: a Commander who opens Nav
    // Beacon is shown what it carries rather than dropped into one of its tools
    // (`.design/Home.dc.html`).
    //
    // Being a screen rather than a redirect is also what makes Back work. A
    // redirect replaces itself, so there was nothing here to come back to.
    path: '',
    pathMatch: 'full',
    // The bar names the product here, because that is what the canvas draws in
    // the identity deck: `NAV BEACON`, not the masthead below it. The screen a
    // Commander is on *is* the product, so the tab carries the product's own
    // title rather than its name twice over — see `resolveDocumentTitle`.
    title: 'app.name',
    data: { description: 'app.description' },
    loadComponent: () => import('./features/start/start.page').then((module) => module.StartPage),
  },
  {
    path: 'ships',
    title: 'catalogue.title',
    data: { description: 'catalogue.description' },
    loadComponent: () =>
      import('./features/ship-catalogue/ship-catalogue.page').then(
        (module) => module.ShipCataloguePage,
      ),
    children: [
      {
        // The command bar keeps the catalogue's own name while a hull is open in
        // the inspector, as the reference's does (canvas 1a), and the compact
        // sheet carries the hull's name in its own heading. The bar is drawn
        // from `ScreenChrome` and takes nothing from here, so what these two
        // keys change is the *document*, not the screen.
        //
        // They name the hull because an address has to say which one it is:
        // forty-nine addresses describing themselves identically are one
        // address as far as a search engine is concerned (011/FR-027).
        //
        // Both patterns interpolate `{{hull}}`. `RouteTitleStrategy` supplies it
        // from the package and, where the segment resolves to no hull,
        // publishes the catalogue's identity instead rather than a sentence
        // with a hole in it.
        //
        // The segment is the hull's name made URL-ready — `Type-11_Prospector`,
        // not `LakonMiner` — because an address a Commander reads and a search
        // result quotes should name the ship (001/FR-005). The symbol is still
        // the identity everywhere else, and is still accepted here so an
        // address published before the rule opens the hull it named.
        path: ':hull',
        title: 'hullDetail.title',
        data: { description: 'hullDetail.description' },
        loadComponent: () =>
          import('./features/hull-detail/hull-detail.page').then((module) => module.HullDetailPage),
      },
    ],
  },
  {
    path: 'outfitting',
    title: 'workspace.title',
    data: { description: 'workspace.description' },
    loadComponent: () =>
      import('./features/build-workspace/build-workspace.page').then(
        (module) => module.BuildWorkspacePage,
      ),
  },
  {
    path: 'equipment',
    title: 'equipment.title',
    data: { description: 'equipment.description' },
    loadComponent: () =>
      import('./features/equipment/equipment-bench.page').then(
        (module) => module.EquipmentBenchPage,
      ),
  },
  // An address that resolves to nothing lands where a Commander who typed the
  // product's name lands, rather than inside a tool they did not ask for.
  { path: '**', redirectTo: '' },
];
