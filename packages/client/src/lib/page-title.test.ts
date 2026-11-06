import { expect, test } from "vite-plus/test";
import { titleWithoutSite } from "~/lib/page-title";

test("Amazon's store and department go", () => {
  expect(
    titleWithoutSite(
      "PINOLINO Fiete Children's Walker with Brake System, Solid Wood: Beech Blue Varnished : Amazon.de: Baby Products",
      "https://www.amazon.de/-/en/PINOLINO/dp/B0821HZLRV/",
    ),
  ).toBe("PINOLINO Fiete Children's Walker with Brake System, Solid Wood: Beech Blue Varnished");
});

test("a shop's name after a dash goes, matched to its address", () => {
  expect(
    titleWithoutSite(
      "Kinderkraft Cutie Balance Bike – Mari Kali Stores Cyprus",
      "https://www.marikali.cy/products/kinderkraft-cutie-balance-bike?variant=1",
    ),
  ).toBe("Kinderkraft Cutie Balance Bike");
});

test("the usual suffixes go", () => {
  expect(titleWithoutSite("Rates held - BBC News", "https://www.bbc.co.uk/news/1")).toBe(
    "Rates held",
  );
});

test("a site's name leading the title goes", () => {
  expect(
    titleWithoutSite("GitHub - MMMikeM/ajot: A calm task list", "https://github.com/MMMikeM/ajot"),
  ).toBe("MMMikeM/ajot: A calm task list");
});

test("the site's own name, given, goes when the address doesn't say it", () => {
  expect(titleWithoutSite("Soup recipe | The Kitchn", "https://recipes.example.com/soup")).toBe(
    "Soup recipe | The Kitchn",
  );
  expect(
    titleWithoutSite("Soup recipe | The Kitchn", "https://recipes.example.com/soup", "The Kitchn"),
  ).toBe("Soup recipe");
});

test("a title with nothing of the site's is kept", () => {
  expect(titleWithoutSite("Pros - Cons", "https://example.com/")).toBe("Pros - Cons");
  expect(titleWithoutSite("YouTube", "https://www.youtube.com/")).toBe("YouTube");
  expect(titleWithoutSite("Notes", "not an address")).toBe("Notes");
});
