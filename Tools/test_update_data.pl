#!/usr/bin/env perl

use strict;
use warnings;
use utf8;
use FindBin qw($RealBin);
use File::Temp qw(tempfile);
use Test::More;

require "$RealBin/update_banlists.pl";
require "$RealBin/update_card_data.pl";

subtest 'calendar filters regional release products' => sub {
  my $source = <<'HTML';
<ul>
  <li>Japanese release date for <a href="/wiki/Japanese_Pack">Pack</a></li>
  <li>North American release date for <a href="/wiki/TCG_Pack">Pack</a></li>
  <li>Asian-English release date for <a href="/wiki/AE_Pack">Pack</a></li>
</ul>
HTML
  is_deeply(
    UpdateCardData::calendar_product_urls($source, 2026),
    [
      'https://yugipedia.com/wiki/AE_Pack',
      'https://yugipedia.com/wiki/Japanese_Pack',
      'https://yugipedia.com/wiki/TCG_Pack',
    ],
    'keeps supported TCG, Asian-English, and Japanese release links',
  );
};

subtest 'set card list links avoid edit actions' => sub {
  my $source = <<'HTML';
<a href="/wiki/Set_Card_Lists:Example_(OCG-JP)?action=edit">Edit list</a>
<a href="/wiki/Set_Card_Lists:Example_(OCG-JP)">Published list</a>
HTML
  is_deeply(
    UpdateCardData::set_list_urls(
      $source,
      'https://yugipedia.com/wiki/Example_Pack',
    ),
    ['https://yugipedia.com/wiki/Set_Card_Lists:Example_(OCG-JP)'],
    'normalizes edit links to the public card-list page',
  );
};

subtest 'card rows and release dates parse' => sub {
  my $source = <<'HTML';
<div>(Release date: 16 May 2026)</div>
<table>
  <tr><th>Card number</th><th>Name</th><th>Rarity</th><th>Category</th></tr>
  <tr>
    <td><a href="/wiki/ABC-AE001">ABC-AE001</a></td>
    <td>"<a href="/wiki/Example_Card">Example Card (updated from: Old Card)</a>"</td>
    <td><a href="/wiki/Common">Common</a><br><a href="/wiki/Rare">Rare</a></td>
    <td><a href="/wiki/Effect">Effect</a><a href="/wiki/Tuner">Tuner monster</a></td>
  </tr>
</table>
HTML
  is(UpdateCardData::parse_release_date($source), '2026-05-16', 'parses release date');
  is(
    UpdateCardData::parse_release_date('<div>(Release date: December 2026)</div>'),
    '2026-12-01',
    'parses month-only release dates so upcoming sets can be skipped',
  );
  is(UpdateCardData::clean_card_name('"Example Card"'), 'Example Card', 'cleans quoted name');
  is_deeply(
    UpdateCardData::parse_card_rows($source, 'Example Set'),
    [{
      set_name => 'Example Set',
      card_code => 'ABC-AE001',
      card_name => 'Example Card',
      rarity => ['Common', 'Rare'],
      category => ['Effect', 'Tuner monster'],
      print => '',
    }],
    'parses card code, name, rarity and category',
  );
};

subtest 'Japanese set tables retain rarity variants in header-selected columns' => sub {
  my $source = <<'HTML';
<table>
  <tr><th>Card number</th><th>English name</th><th>Japanese name</th><th>Rarity</th><th>Category</th><th>Print</th></tr>
  <tr>
    <td><a href="/wiki/BETB-JP001">BETB-JP001</a></td>
    <td>"<a href="/wiki/Example_Card">Example Card</a>"</td>
    <td>Example Japanese name</td>
    <td><a href="/wiki/Super_Rare">Super Rare</a><br><a href="/wiki/Secret_Rare">Secret Rare</a></td>
    <td><a href="/wiki/Effect_Monster">Effect Monster</a></td>
    <td>New</td>
  </tr>
  <tr>
    <td><a href="/wiki/BETB-JP001">BETB-JP001</a></td>
    <td>"<a href="/wiki/Example_Card">Example Card</a>"</td>
    <td>Example Japanese name</td>
    <td><a href="/wiki/Prismatic_Secret_Rare">Prismatic Secret Rare</a></td>
    <td><a href="/wiki/Effect_Monster">Effect Monster</a></td>
    <td>Reprint</td>
  </tr>
  <tr>
    <td><a href="/wiki/BETB-JP027">BETB-JP027</a></td>
    <td>"<a href="/wiki/The_Great_Gallant_Bandit">The Great Gallant Bandit</a>"</td>
    <td>天下独歩の大義賊</td>
    <td><a href="/wiki/Ultimate_Rare">Ultimate Rare</a><br><a href="/wiki/Secret_Rare">Secret Rare</a></td>
    <td><a href="/wiki/Effect_Monster">Effect Monster</a></td>
    <td>New</td>
  </tr>
  <tr>
    <td><a href="/wiki/BETB-JP027">BETB-JP027</a></td>
    <td>"<a href="/wiki/The_Great_Gallant_Bandit">The Great Gallant Bandit</a>" (extended art)</td>
    <td>天下独歩の大義賊</td>
    <td><a href="/wiki/Prismatic_Secret_Rare">Prismatic Secret Rare</a></td>
    <td><a href="/wiki/Effect_Monster">Effect Monster</a></td>
    <td>Reprint</td>
  </tr>
  <tr>
    <td><a href="/wiki/RD/P013-JP001">RD/P013-JP001</a></td>
    <td><a href="/wiki/Fusion_(Rush_Duel)">Fusion</a></td>
    <td>フュージョン</td>
    <td><a href="/wiki/Over_Rush_Rare">Over Rush Rare</a></td>
    <td><a href="/wiki/Normal_Spell">Normal Spell</a></td>
    <td>New</td>
  </tr>
</table>
HTML
  my $rows = UpdateCardData::parse_card_rows($source, 'Beyond the Brave');
  is(scalar @$rows, 5, 'parses all card rows including Rush Duel codes');
  is_deeply(
    $rows->[0]{rarity},
    ['Super Rare', 'Secret Rare'],
    'reads rarity values from the rarity header instead of the Japanese-name column',
  );
  is($rows->[4]{card_code}, 'RD/P013-JP001', 'accepts slash-separated card codes');
  is($rows->[4]{rarity}[0], 'Over Rush Rare', 'reads rarity for slash-separated card codes');
  is(UpdateCardData::list_region(
    'https://yugipedia.com/wiki/Set_Card_Lists:Beyond_the_Brave_(OCG-JP)'
  ), 'OCG', 'classifies Japanese OCG lists');
  is(UpdateCardData::list_set_name(
    'https://yugipedia.com/wiki/Set_Card_Lists:Beyond_the_Brave_(OCG-JP)'
  ), 'Beyond the Brave', 'extracts the Japanese OCG set name');
  is(UpdateCardData::list_set_name(
    'https://yugipedia.com/wiki/Set_Card_Lists:Revolution_Booster:_Toon_/_Witchcrafter_/_Unchained_(OCG-JP)'
  ), 'Revolution Booster: Toon / Witchcrafter / Unchained',
    'preserves slashes in Japanese set names');
  is_deeply(
    UpdateCardData::deduplicate_printing_rows($rows)->[0]{rarity},
    ['Super Rare', 'Secret Rare', 'Prismatic Secret Rare'],
    'unions rarities from duplicate rows for the same set and card code',
  );
  is_deeply(
    UpdateCardData::deduplicate_printing_rows($rows)->[1]{rarity},
    ['Ultimate Rare', 'Secret Rare', 'Extended Art Prismatic Secret Rare'],
    'keeps extended-art printings as a distinct rarity on the canonical card',
  );
  is(
    UpdateCardData::deduplicate_printing_rows($rows)->[1]{card_name},
    'The Great Gallant Bandit',
    'does not turn extended-art notation into a separate card name',
  );
};

subtest 'refreshes scraped rarity variants' => sub {
  my $ae = {
    source => 'test',
    region => 'AE',
    data => [{
      set_name => 'Example Set',
      card_code => 'EX-AE001',
      card_name => 'Example Card',
      rarity => ['Not Applicable', 'Super Rare'],
      category => ['Effect'],
      print => 'New',
    }],
  };
  my $merged_ae = UpdateCardData::merge_ae_printings($ae, [
    {
      set_name => 'Example Set',
      card_code => 'EX-AE001',
      card_name => 'Example Card',
      rarity => ['Secret Rare'],
      category => ['Effect'],
      print => '',
    },
    {
      set_name => 'Example Set',
      card_code => 'EX-AE001',
      card_name => 'Example Card',
      rarity => ['Common', 'Ultra Rare'],
      category => ['Effect'],
      print => '',
    },
  ]);
  is(scalar @{$merged_ae->{data}}, 1, 'keeps one row per set and card code');
  is_deeply(
    $merged_ae->{data}[0]{rarity},
    ['Secret Rare', 'Common', 'Ultra Rare'],
    'replaces stale AE rarities with the complete scraped variant set',
  );

  my $ocg = {
    source => 'test',
    region => 'OCG',
    data => [{
      set_name => 'Example OCG Set',
      card_code => 'EX-JP001',
      card_name => 'Old Example Card',
      rarity => ['Not Applicable', 'Common'],
    }],
  };
  my $merged_ocg = UpdateCardData::merge_ocg_printings($ocg, [{
    set_name => 'Example OCG Set',
    card_code => 'EX-JP001',
    card_name => 'Example Card',
    rarity => ['Rare', 'Secret Rare'],
  }]);
  is_deeply(
    $merged_ocg->{data}[0]{rarity},
    ['Rare', 'Secret Rare'],
    'replaces stale OCG rarities with the complete scraped variants',
  );
  is(
    $merged_ocg->{data}[0]{card_name},
    'Example Card',
    'refreshes the card name from the current set list',
  );

  my $tcg = {
    data => [{
      id => 1,
      name => 'The Great Gallant Bandit',
      card_sets => [
        {
          set_name => 'Old Set',
          set_code => 'OLD-EN001',
          set_rarity => 'Common',
          set_rarity_code => '(C)',
          set_price => '0',
        },
        {
          set_name => 'Beyond the Brave',
          set_code => 'BETB-EN027',
          set_rarity => 'Secret Rare',
          set_rarity_code => '(ScR)',
          set_price => '0',
        },
      ],
    }],
  };
  my ($merged_tcg, $updated_codes) = UpdateCardData::merge_tcg_printings($tcg, [
    {
      set_name => 'Beyond the Brave',
      card_code => 'BETB-EN027',
      card_name => 'The Great Gallant Bandit',
      rarity => ['Secret Rare', 'Extended Art Ultra Rare'],
    },
  ]);
  is_deeply(
    [map { $_->{set_rarity} } @{$merged_tcg->{data}[0]{card_sets}}],
    ['Common', 'Secret Rare', 'Extended Art Ultra Rare'],
    'updates TCG card_sets from scraped rarity variants without dropping other sets',
  );
  ok($updated_codes->{BETBEN027}, 'reports the TCG set code that was refreshed');
};

subtest 'updates only released cards and preserves document shapes' => sub {
  my $cards = {
    data => [{
      id => 1,
      name => 'Existing Card',
      card_sets => [{ set_code => 'OLD-EN001' }],
      asian_english_sets => [],
    }],
  };
  my $tcg = {
    data => [{
      id => 1,
      name => 'Existing Card',
      card_sets => [{ set_code => 'OLD-EN001' }],
      card_prices => [],
    }],
  };
  my $ae = { source => 'test', region => 'AE', data => [] };
  my $api = [
    {
      id => 2,
      name => 'New Card',
      desc => 'text',
      card_sets => [{ set_code => 'NEW-EN001' }],
      card_prices => [{ tcgplayer_price => '1.00' }],
      misc_info => [{ konami_id => 20 }],
    },
    {
      id => 3,
      name => 'Unrelated Card',
      card_sets => [{ set_code => 'OTHER-EN001' }],
      card_prices => [],
    },
  ];
  my $released = {
    TCG => [{
      set_name => 'New Set',
      card_code => 'NEW-EN001',
      card_name => 'New Card',
      rarity => ['Common'],
      category => ['Effect'],
      print => '',
    }],
    AE => [{
      set_name => 'New Set',
      card_code => 'NEW-AE001',
      card_name => 'New Card',
      rarity => ['Common'],
      category => ['Effect'],
      print => '',
    }],
  };

  my ($updated_cards, $updated_tcg, $updated_ae, $selected, $unmatched) =
    UpdateCardData::build_updates($cards, $tcg, $ae, $api, $released);
  is_deeply($selected, { 2 => 1 }, 'selects only the released card');
  is_deeply($unmatched, [], 'reports no unmatched entries');
  is_deeply(
    [map { $_->{id} } @{$updated_cards->{data}}],
    [1, 2],
    'adds matched card to catalog',
  );
  is_deeply(
    [map { $_->{id} } @{$updated_tcg->{data}}],
    [1, 2],
    'adds matched card to TCG catalog',
  );
  ok(!exists $updated_cards->{data}[1]{card_prices}, 'omits prices from card catalog');
  ok(!exists $updated_tcg->{data}[1]{asian_english_sets}, 'omits AE sets from TCG catalog');
  is(
    $updated_cards->{data}[1]{asian_english_sets}[0]{card_code},
    'NEW-AE001',
    'includes merged AE printing',
  );
  is(
    $updated_tcg->{data}[1]{card_prices}[0]{tcgplayer_price},
    '1.00',
    'preserves API prices in TCG catalog',
  );
  is($updated_ae->{data}[0]{card_code}, 'NEW-AE001', 'adds AE printing');
};

subtest 'JSON writer supports compact catalog output' => sub {
  my ($file, $path) = tempfile();
  close $file or die "Unable to close temporary file: $!\n";
  YgoUpdater::write_json($path, { data => ['One', 'Two'] }, 1);
  open my $saved, '<:raw', $path or die "Unable to read temporary file: $!\n";
  local $/;
  my $contents = <$saved>;
  close $saved or die "Unable to close temporary file: $!\n";
  is($contents, "{\"data\":[\"One\",\"Two\"]}\n", 'writes compact UTF-8 JSON');
  unlink $path or die "Unable to remove temporary file: $!\n";
};

subtest 'banlist parsers normalize names and map OCG IDs' => sub {
  my $page = <<'HTML';
<div id="list_forbidden">
  <div class="t_row"><div><span class="name">Forbidden JP (updated from: old name)</span>
    <input class="link_value" value="/card?cid=101"></div></div>
</div>
<div id="list_limited">
  <div class="t_row"><div><span class="name">Limited JP</span>
    <input class="link_value" value="/card?cid=102"></div></div>
</div>
<div id="list_semi_limited">
  <div class="t_row"><div><span class="name">Semi JP</span>
    <input class="link_value" value="/card?cid=103"></div></div>
</div>
HTML
  my $rows = UpdateBanlists::parse_banlist_page($page);
  my $mapped = UpdateBanlists::resolve_ocg_names($rows, {
    101 => 'Forbidden EN',
    102 => 'Limited EN',
    103 => 'Semi EN',
  });
  is($rows->{Forbidden}[0]{name}, 'Forbidden JP', 'cleans updated-from suffix');
  is_deeply($mapped->{Forbidden}, ['Forbidden EN'], 'maps forbidden entry');
  is_deeply($mapped->{Limited}, ['Limited EN'], 'maps limited entry');
  is_deeply($mapped->{'Semi-Limited'}, ['Semi EN'], 'maps semi-limited entry');
};

subtest 'banlist dates parse in English and Japanese formats' => sub {
  is(
    UpdateBanlists::parse_updated_date('<span>Status Updated 04/01/2026</span>', 'en'),
    '2026-04-01',
    'parses English update date',
  );
  is(
    UpdateBanlists::parse_updated_date('<span>2026/10/01 更新</span>', 'ja'),
    '2026-10-01',
    'parses Japanese update date',
  );
};

done_testing();
