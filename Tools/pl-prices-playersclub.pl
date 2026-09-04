use strict;
use warnings;
use JSON::PP qw(decode_json encode_json);
use File::Basename qw(dirname);
use File::Path qw(make_path);

binmode(STDOUT, ':encoding(UTF-8)');

# Harvest Players Club Asian-English singles for GitHub Actions.
# Run from the repository root:
#   perl Tools/pl-prices-playersclub.pl

my $UA = 'Mozilla/5.0 (compatible; YGO-Collect price harvester)';
my $COLLECTION = $ENV{PLAYERS_CLUB_COLLECTION} || 'ygoae1';
my $BASE = "https://playersclubhk.com/en/collections/$COLLECTION/products.json";
my $OUT = $ENV{PLAYERS_CLUB_OUTPUT} || 'playersclub-prices.json';
my $MAX_PAGES = 60;
my $PAGE_SIZE = 250;

for my $argument (@ARGV) {
  $COLLECTION = $1 if $argument =~ /^--collection=(.+)$/;
  $OUT = $1 if $argument =~ /^--out=(.+)$/;
}
$BASE = "https://playersclubhk.com/en/collections/$COLLECTION/products.json";

sub json_from {
  my ($body, $url) = @_;
  my $json = eval { decode_json($body) };
  die "Invalid JSON from $url: $@\n" unless $json && ref($json) eq 'HASH';
  return $json;
}

sub parse_title {
  my ($raw) = @_;
  return unless defined $raw;

  return unless $raw =~ /^\s*([A-Z0-9]{2,12}-[A-Z]{2,5}[A-Z0-9]{1,6})\s*(.*)$/i;
  my ($code, $rest) = (uc($1), $2);

  my $condition = '';
  $condition = uc($1) if $raw =~ /\(\s*Status\s*([A-Za-z])\s*\)/i;
  $condition = 'D' if !$condition && $raw =~ /damaged|\bDMG\b|played/i;

  my $without_status = $rest;
  $without_status =~ s/\(\s*Status[^)]*\)\s*//gi;
  $without_status =~ s/\s+$//;

  my $rarity = '';
  $rarity = $1 if $without_status =~ /\(\s*((?:UR|SER|UTR|PSER|QCSE|SR|R|C|CR|ESR|ESER|EXSER|OSER|NPR|AA)(?:\s*\/\s*(?:UR|SER|UTR|PSER|QCSE|SR|R|C|CR|ESR|ESER|EXSER|OSER|NPR|AA))*)\s*\)/i;
  $rarity =~ s/^\s+|\s+$//g if $rarity;
  $rarity = uc($rarity) if $rarity;

  $rest =~ s/\(\s*Status[^)]*\)//gi;
  $rest =~ s/\(\s*(?:UR|SER|UTR|PSER|QCSE|SR|R|C|CR|ESR|ESER|EXSER|OSER|NPR|AA)(?:\s*\/\s*(?:UR|SER|UTR|PSER|QCSE|SR|R|C|CR|ESR|ESER|EXSER|OSER|NPR|AA))*)\s*\)//ig;
  $rest =~ s/\s+/ /g;
  $rest =~ s/^\s+|\s+$//g;

  return {
    code => $code,
    name => $rest,
    rarity => $rarity,
    condition => $condition
  };
}

sub run_curl {
  my ($url) = @_;
  my $command = sprintf(
    'curl --fail --silent --show-error --location --max-time 60 --user-agent "%s" "%s"',
    $UA,
    $url
  );
  my $body = `$command`;
  die "curl failed for $url (exit $? )\n" if $? != 0;
  return $body;
}

my @rows;
my $skipped = 0;
my %seen;

for my $page (1 .. $MAX_PAGES) {
  my $url = "$BASE?limit=$PAGE_SIZE&page=$page";
  printf "page %2d ... ", $page;

  my $json = json_from(run_curl($url), $url);
  my $products = $json->{products};
  die "Unexpected response from $url: products is not an array\n"
    unless ref($products) eq 'ARRAY';

  last unless @$products;
  my $page_rows = 0;

  for my $product (@$products) {
    next unless ref($product) eq 'HASH';
    my $parsed = parse_title($product->{title});
    unless ($parsed) {
      $skipped++;
      next;
    }

    my $variants = $product->{variants};
    $variants = [{}] unless ref($variants) eq 'ARRAY' && @$variants;

    for my $variant (@$variants) {
      next unless ref($variant) eq 'HASH';
      my $price = defined $variant->{price} ? 0 + $variant->{price} : 0;
      my $available = exists $variant->{available}
        ? ($variant->{available} ? 1 : 0)
        : 1;
      my $variant_rarity = $parsed->{rarity} || $variant->{title} || '';
      my $key = join('|', $parsed->{code}, $variant_rarity, $parsed->{condition}, $price, $available);
      next if $seen{$key}++;

      if ($price <= 0) {
        $skipped++;
        next;
      }

      push @rows, [
        $parsed->{code},
        $price,
        $parsed->{name},
        $variant_rarity,
        $parsed->{condition},
        $available
      ];
      $page_rows++;
    }
  }

  printf "%d products, %d rows added\n", scalar(@$products), $page_rows;
  last if @$products < $PAGE_SIZE;
}

die "Nothing harvested. The collection name may have changed: $COLLECTION\n"
  unless @rows;

my @prices = sort { $a <=> $b } map { $_->[1] } @rows;
my $median = $prices[int(@prices / 2)] || 0;
my @time = localtime;
my $date = sprintf '%04d-%02d-%02d', $time[5] + 1900, $time[4] + 1, $time[3];

my $output_dir = dirname($OUT);
make_path($output_dir) if $output_dir ne '.' && !-d $output_dir;
open my $output, '>:raw', $OUT or die "Cannot write $OUT: $!\n";
print {$output} encode_json({
  generatedAt => $date,
  currency => 'HKD',
  source => 'Players Club',
  collection => $COLLECTION,
  rows => \@rows
});
close $output or die "Cannot close $OUT: $!\n";

printf "\n%d price rows -> %s (currency HKD, median %.2f)\n", scalar(@rows), $OUT, $median;
printf "%d listings skipped\n", $skipped if $skipped;
