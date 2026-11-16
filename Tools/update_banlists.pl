#!/usr/bin/env perl

package UpdateBanlists;

use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));
use FindBin qw($RealBin);
use lib $RealBin;
use YgoUpdater qw(fetch_text fetch_json write_json html_events text_from_html trim);
use Time::Piece;

my $ROOT = "$RealBin/..";
my $BANLIST_PATH = "$ROOT/data/banlists.json";
my $CARD_API_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';
my %SOURCE_URLS = (
  TCG => 'https://www.db.yugioh-card.com/yugiohdb/forbidden_limited.action?request_locale=en',
  AE => 'https://www.db.yugioh-card.com/yugiohdb/forbidden_limited.action?request_locale=ae',
  OCG => 'https://cardcluster.com/limited-list/ocg',
);
my %SECTION_KEYS = (
  list_forbidden => 'Forbidden',
  list_limited => 'Limited',
  list_semi_limited => 'Semi-Limited',
);

sub clean_card_name {
  my ($name) = @_;
  $name = trim($name);
  $name =~ s/\s*\(updated from:.*\)\s*$//i;
  return trim($name);
}

sub parse_banlist_page {
  my ($page) = @_;
  my $rows = {
    'Forbidden' => [],
    'Limited' => [],
    'Semi-Limited' => [],
  };
  my ($section, $row, $in_name);

  for my $event (@{html_events($page)}) {
    if ($event->{type} eq 'start') {
      my $tag = $event->{tag};
      my $attributes = $event->{attributes};
      my %classes = map { $_ => 1 } split /\s+/, ($attributes->{class} || '');
      if ($tag eq 'div') {
        my $section_id = $attributes->{id} || '';
        $section = $SECTION_KEYS{$section_id} if exists $SECTION_KEYS{$section_id};
        if (!$row && $section && $classes{t_row}) {
          $row = { section => $section, depth => 1, name => '', href => '' };
        } elsif ($row) {
          $row->{depth}++;
        }
      }
      if ($row) {
        if ($tag eq 'span' && $classes{name}) {
          $in_name = 1;
        } elsif ($tag eq 'input' && $classes{link_value}) {
          $row->{href} = $attributes->{value} || '';
        }
      }
    } elsif ($event->{type} eq 'text') {
      $row->{name} .= $event->{data} if $row && $in_name;
    } elsif ($event->{type} eq 'end') {
      $in_name = 0 if $event->{tag} eq 'span' && $in_name;
      if ($event->{tag} eq 'div' && $row) {
        $row->{depth}--;
        if ($row->{depth} == 0) {
          my $name = clean_card_name($row->{name});
          push @{$rows->{$row->{section}}}, {
            name => $name,
            href => $row->{href},
          } if length $name;
          $row = undef;
        }
      }
    }
  }

  for my $section_name (keys %$rows) {
    die "Official page has no cards in $section_name\n"
      unless @{$rows->{$section_name}};
  }
  return $rows;
}

sub parse_updated_date {
  my ($page, $locale) = @_;
  my $text = text_from_html($page);
  my @dates;
  if ($locale eq 'ja') {
    while ($text =~ /(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/g) {
      my ($year, $month, $day) = ($1, $2, $3);
      my $date = sprintf('%04d-%02d-%02d', $year, $month, $day);
      die "Invalid official update date: $date\n" unless Time::Piece->strptime($date, '%Y-%m-%d');
      push @dates, $date;
    }
  } else {
    while ($text =~ /Status\s+Updated\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/ig) {
      my ($month, $day, $year) = ($1, $2, $3);
      my $date = sprintf('%04d-%02d-%02d', $year, $month, $day);
      my $parsed = eval { Time::Piece->strptime($date, '%Y-%m-%d') };
      die "Invalid official update date: $date\n" unless $parsed;
      push @dates, $date;
    }
  }
  die "No official update date found for locale $locale\n" unless @dates;
  @dates = sort @dates;
  return $dates[-1];
}

sub get_konami_name_map {
  my ($api_data) = @_;
  my %names;
  for my $card (@$api_data) {
    for my $misc (@{$card->{misc_info} || []}) {
      next unless defined $misc->{konami_id};
      my $key = "$misc->{konami_id}";
      my $name = trim($card->{name});
      next unless length $name;
      if ($names{$key} && $names{$key} ne $name) {
        die "Ambiguous English names for Konami card ID $key: $names{$key} and $name\n";
      }
      $names{$key} = $name;
    }
  }
  return \%names;
}

sub resolve_ocg_names {
  my ($rows, $konami_names) = @_;
  my (%resolved, @missing);
  for my $section (keys %$rows) {
    my @names;
    for my $card (@{$rows->{$section}}) {
      my ($id) = ($card->{href} || '') =~ /[?&]cid=(\d+)/;
      if (!$id) {
        push @missing, "$section: $card->{name} (no Konami ID)";
        next;
      }
      if (!$konami_names->{$id}) {
        push @missing, "$section: $card->{name} (ID $id)";
        next;
      }
      push @names, $konami_names->{$id};
    }
    $resolved{$section} = \@names;
  }
  if (@missing) {
    my $sample = join '; ', @missing[0 .. ($#missing < 7 ? $#missing : 7)];
    die "Could not map " . scalar(@missing) . " OCG list entries to English names: $sample\n";
  }
  return \%resolved;
}

sub make_region_list {
  my ($region, $rows, $updated, $konami_names) = @_;
  my $names_by_section;
  if ($region eq 'OCG') {
    $names_by_section = resolve_ocg_names($rows, $konami_names);
  } else {
    $names_by_section = {
      map {
        my $section = $_;
        $section => [map { $_->{name} } @{$rows->{$section}}]
      } keys %$rows
    };
  }
  my %region_name = (
    TCG => 'TCG',
    AE => 'Asian English OCG',
    OCG => 'OCG',
  );
  my %result = (
    name => $region_name{$region},
    source => $SOURCE_URLS{$region},
    updated => $updated,
  );
  for my $section (keys %$names_by_section) {
    my %seen;
    my @unique = sort { lc($a) cmp lc($b) } grep { !$seen{$_}++ } @{$names_by_section->{$section}};
    $result{$section} = \@unique;
  }
  return \%result;
}

sub build_banlists {
  my ($page_by_region, $api_data) = @_;
  my $konami_names = get_konami_name_map($api_data);
  my %result;
  my %locale = (TCG => 'en', AE => 'ae', OCG => 'ja');
  for my $region (keys %$page_by_region) {
    my $rows = parse_banlist_page($page_by_region->{$region});
    my $updated = parse_updated_date($page_by_region->{$region}, $locale{$region});
    $result{$region} = make_region_list($region, $rows, $updated, $konami_names);
  }
  return \%result;
}

sub main {
  my $dry_run = 0;
  for my $argument (@ARGV) {
    if ($argument eq '--dry-run') {
      $dry_run = 1;
    } else {
      die "Unknown option: $argument\nUsage: perl Tools/update_banlists.pl [--dry-run]\n";
    }
  }

  my %pages = map { $_ => fetch_text($SOURCE_URLS{$_}) } qw(TCG AE OCG);
  my $api_document = fetch_json($CARD_API_URL);
  my $api_data = $api_document->{data};
  die "YGOPRODeck returned no card data for OCG name mapping\n"
    unless ref($api_data) eq 'ARRAY' && @$api_data;

  my $updated = build_banlists(\%pages, $api_data);
  for my $region (qw(TCG AE OCG)) {
    my $value = $updated->{$region};
    my $count = @{$value->{Forbidden}} + @{$value->{Limited}} + @{$value->{'Semi-Limited'}};
    print "$region: $count restricted cards; official update $value->{updated}\n";
  }
  return if $dry_run;

  write_json($BANLIST_PATH, $updated);
  print "Wrote $BANLIST_PATH\n";
}

unless (caller) {
  eval { main(); 1 } or do {
    my $error = $@ || "Unknown error\n";
    print STDERR "Banlist update failed: $error";
    exit 1;
  };
}

1;
