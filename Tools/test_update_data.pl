#!/usr/bin/env perl

use strict;
use warnings;
use utf8;
use FindBin qw($RealBin);
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
      'https://yugipedia.com/wiki/TCG_Pack',
    ],
    'keeps TCG and Asian-English release links only',
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
