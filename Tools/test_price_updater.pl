use strict;
use warnings;
use utf8;
use Test::More;
use FindBin;
use lib $FindBin::Bin;
use PriceUpdater qw(parse_price_title);

my $tcg = parse_price_title(
  'TCG_CORNER',
  'RD/P013-AE001 Example Card (UR)'
);
is($tcg->{code}, 'RD/P013-AE001', 'TCG Corner accepts slash-separated printing codes');
is($tcg->{name}, 'Example Card', 'TCG Corner parses card name');
is($tcg->{rarity}, 'UR', 'TCG Corner parses rarity');

my $tcg_alpha_suffix = parse_price_title(
  'TCG_CORNER',
  'LAVD-AEO37 S:P Little Knight (N)'
);
is($tcg_alpha_suffix->{code}, 'LAVD-AEO37', 'TCG Corner accepts alphanumeric printing-code suffixes');
is($tcg_alpha_suffix->{name}, 'S:P Little Knight', 'TCG Corner parses alphanumeric-code card name');

my $players_ae = parse_price_title(
  'PLAYERS_CLUB_AE',
  'RD/P013-AE001 Example Card (SER) (Status B)'
);
is($players_ae->{code}, 'RD/P013-AE001', 'Players Club AE accepts slash-separated printing codes');
is($players_ae->{rarity}, 'SER', 'Players Club AE parses rarity before status');
is($players_ae->{condition}, 'B', 'Players Club AE preserves condition');

my $players_ae_recent = parse_price_title(
  'PLAYERS_CLUB_AE',
  'PHNI-AE001(SR/SER/QCSE)Spirit of Yubel(Spirit Alias)'
);
is($players_ae_recent->{code}, 'PHNI-AE001', 'Players Club AE accepts titles without a code/name space');
is($players_ae_recent->{name}, 'Spirit of Yubel(Spirit Alias)', 'Players Club AE removes leading multi-rarity label');
is($players_ae_recent->{rarity}, '', 'Players Club AE defers multi-rarity selection to the variant');

my $players_ocg = parse_price_title(
  'PLAYERS_CLUB_OCG',
  'RD/P013-JP001（UR） Example Card'
);
is($players_ocg->{code}, 'RD/P013-JP001', 'Players Club OCG accepts slash-separated printing codes');
is($players_ocg->{name}, 'Example Card', 'Players Club OCG removes full-width rarity parentheses');
is($players_ocg->{rarity}, 'UR', 'Players Club OCG reads full-width rarity parentheses');

my $ordinary_ocg = parse_price_title(
  'PLAYERS_CLUB_OCG',
  'YOS3-JP001(UR) Vera, Endymion\'s Handmaid'
);
is($ordinary_ocg->{name}, 'Vera, Endymion\'s Handmaid', 'existing OCG title format remains supported');
is($ordinary_ocg->{rarity}, 'UR', 'existing OCG rarity format remains supported');

done_testing();
