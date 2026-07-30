const repository = "JHoff1/VerityPDF";
const apiVersion = "2022-11-28";
const platforms = ["Windows", "macOS", "Linux"];

function platformForAsset(name) {
  const normalized = name.toLowerCase();
  if (/\.(exe|msi|msix|msixbundle|appinstaller)$/.test(normalized)) {
    return "Windows";
  }
  if (/\.(dmg|pkg)$/.test(normalized)) {
    return "macOS";
  }
  if (/\.(appimage|deb|rpm)$/.test(normalized)) {
    return "Linux";
  }
  return null;
}

function summarize(assets) {
  const totals = Object.fromEntries(platforms.map((platform) => [platform, 0]));
  for (const asset of assets) {
    const platform = platformForAsset(asset.name);
    if (platform) totals[platform] += asset.download_count;
  }
  return totals;
}

function printSummary(title, totals) {
  console.log(`\n${title}`);
  console.table(
    platforms.map((platform) => ({
      Platform: platform,
      Downloads: totals[platform]
    }))
  );
}

async function fetchPublishedReleases() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": apiVersion
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const releases = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
      { headers }
    );
    if (!response.ok) {
      const rateLimitHint =
        response.status === 403
          ? " GitHub may have rate-limited this network; try again later or set GITHUB_TOKEN."
          : "";
      throw new Error(
        `GitHub returned ${response.status} ${response.statusText}.${rateLimitHint}`
      );
    }
    const pageReleases = await response.json();
    releases.push(...pageReleases.filter((release) => !release.draft));
    if (pageReleases.length < 100) return releases;
  }
}

try {
  const releases = await fetchPublishedReleases();
  if (releases.length === 0) {
    console.log("VerityPDF has no published GitHub releases.");
    process.exit(0);
  }

  const latest =
    releases.find((release) => !release.prerelease) ?? releases[0];
  printSummary(
    `Latest release ${latest.tag_name} (${latest.published_at.slice(0, 10)})`,
    summarize(latest.assets)
  );
  printSummary(
    `All ${releases.length} published release${releases.length === 1 ? "" : "s"}`,
    summarize(releases.flatMap((release) => release.assets))
  );
  console.log(
    "\nCounts are GitHub asset downloads, not unique users or confirmed installations."
  );
} catch (error) {
  console.error(
    `Unable to retrieve VerityPDF download counts: ${
      error instanceof Error ? error.message : String(error)
    }`
  );
  process.exitCode = 1;
}
