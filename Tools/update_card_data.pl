#!/usr/bin/env perl

package UpdateCardData;

use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));
use FindBin qw($RealBin);
use lib $RealBin;
use JSON::PP qw(decode_json);
use Time::Piece;
use Time::HiRes qw(sleep);
use YgoUpdater qw(
  fetch_text fetch_json write_json html_events text_from_html trim
  normalize_name normalize_code urljoin urlsplit unquote current_utc_date
);

my $ROOT = "$RealBin/..";
my $CARDS_PATH = "$ROOT/data/cards.json";
my $TCG_PATH = "$ROOT/data/tcg.json";
my $AE_PATH = "$ROOT/data/ae.json";
my $YGOPRODECK_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';

sub clean_card_name {
  my ($name) = @_;
  $name = trim($name);
  $name =~ s/\s*\(updated from:.*\)\s*$//i;
  $name = trim($name);
  if (length($name) >= 2 && $name =~ /^(["\x{201c}\x{201d}])(.*)\1$/s) {
    $name = trim($2);
  }
  return $name;
}

sub calendar_product_urls {
  my ($calendar_html, $year) = @_;
  my $base_url = "https://yugipedia.com/wiki/$year";
  my (@stack, %urls);
  my $anchor;

  for my $event (@{html_events($calendar_html)}) {
    if ($event->{type} eq 'start') {
      if ($event->{tag} eq 'li') {
        push @stack, { text => '', links => [] };
      } elsif ($event->{tag} eq 'a' && @stack) {
        $anchor = { href => $event->{attributes}{href} || '', text => '' };
      }
    } elsif ($event->{type} eq 'text') {
      $stack[-1]{text} .= $event->{data} if @stack;
      $anchor->{text} .= $event->{data} if $anchor;
    } elsif ($event->{type} eq 'end') {
      if ($event->{tag} eq 'a' && $anchor) {
        push @{$stack[-1]{links}}, [$anchor->{href}, trim($anchor->{text})] if @stack;
        $anchor = undef;
      } elsif ($event->{tag} eq 'li' && @stack) {
        my $item = pop @stack;
        my $text = lc(trim($item->{text}));
        my $release_position = index($text, 'release date');
        next if $release_position < 0;
        my $prefix = substr($text, 0, $release_position);
        next unless $prefix =~ /north american|european|oceanic|asian-english|english/;

        for my $link (@{$item->{links}}) {
          my $absolute = urljoin($base_url, $link->[0]);
          my ($scheme, $host, $path) = urlsplit($absolute);
          next unless lc($host) eq 'yugipedia.com' && $path =~ m{^/wiki/};
          my $decoded_path = unquote($path);
          next if $decoded_path =~ m{^/wiki/(?:Category|File|Help|Special|Template)(?::|/)};
          $urls{$absolute} = 1;
        }
      }
    }
  }
  return [sort keys %urls];
}

sub set_list_urls {
  my ($product_html, $product_url) = @_;
  my (%urls, $anchor);
  for my $event (@{html_events($product_html)}) {
    if ($event->{type} eq 'start' && $event->{tag} eq 'a') {
      $anchor = {
        href => $event->{attributes}{href} || '',
        text => '',
      };
    } elsif ($event->{type} eq 'text' && $anchor) {
      $anchor->{text} .= $event->{data};
    } elsif ($event->{type} eq 'end' && $event->{tag} eq 'a' && $anchor) {
      my $href = unquote($anchor->{href});
      if (index($href, 'Set_Card_Lists:') >= 0 &&
          ($href =~ /\(TCG-EN\)/ || $href =~ /\(OCG-AE\)/)) {
        my $absolute = urljoin($product_url, $anchor->{href});
        my @parts = urlsplit($absolute);
        my $host = $parts[1];
        $urls{$absolute} = 1 if lc($host) eq 'yugipedia.com';
      }
      $anchor = undef;
    }
  }
  return [sort keys %urls];
}

sub list_region {
  my ($url) = @_;
  my @parts = urlsplit($url);
  my $path = $parts[2];
  $path = unquote($path);
  return 'TCG' if $path =~ /\(TCG-EN\)$/;
  return 'AE' if $path =~ /\(OCG-AE\)$/;
  die "Unsupported Yugipedia card-list URL: $url\n";
}

sub list_set_name {
  my ($url) = @_;
  my @parts = urlsplit($url);
  my $path = $parts[2];
  my ($title) = $path =~ m{/([^/]+)$};
  $title = unquote($title || '');
  $title =~ tr/_/ /;
  my ($name) = $title =~ /^Set Card Lists:\s*(.*?)\s+\((?:TCG-EN|OCG-AE)\)$/i;
  die "Could not determine set name from $url\n" unless defined $name;
  return trim($name);
}

sub parse_release_date {
  my ($page) = @_;
  my $text = text_from_html($page);
  my ($value) = $text =~ /Release date:\s*([^)]{3,50})/i;
  die "Card-list page has no release date\n" unless defined $value;
  $value = trim($value);

  for my $format (
    '%d %B %Y',
    '%d %b %Y',
    '%B %d, %Y',
    '%b %d, %Y',
    '%Y-%m-%d',
  ) {
    my $date = eval { Time::Piece->strptime($value, $format) };
    return $date->strftime('%Y-%m-%d') if $date;
  }
  die "Unrecognized release date: '$value'\n";
}

sub _cell_text {
  my ($cell) = @_;
  return trim($cell->{text});
}

sub parse_card_rows {
  my ($page, $set_name) = @_;
  my (@rows, $row, $cell, $anchor);

  for my $event (@{html_events($page)}) {
    if ($event->{type} eq 'start') {
      my $tag = $event->{tag};
      if ($tag eq 'tr') {
        $row = [];
      } elsif (($tag eq 'td' || $tag eq 'th') && $row) {
        $cell = { text => '', links => [] };
      } elsif ($tag eq 'a' && $cell) {
        $anchor = '';
      } elsif ($tag eq 'br' && $cell) {
        $cell->{text} .= ' ';
      }
    } elsif ($event->{type} eq 'text') {
      $cell->{text} .= $event->{data} if $cell;
      $anchor .= $event->{data} if defined $anchor;
    } elsif ($event->{type} eq 'end') {
      my $tag = $event->{tag};
      if ($tag eq 'a' && defined $anchor) {
        my $label = trim($anchor);
        push @{$cell->{links}}, $label if $cell && length $label;
        $anchor = undef;
      } elsif (($tag eq 'td' || $tag eq 'th') && $cell) {
        push @$row, $cell if $row;
        $cell = undef;
      } elsif ($tag eq 'tr' && $row) {
        push @rows, $row;
        $row = undef;
      }
    }
  }

  my @result;
  for my $cells (@rows) {
    next if @$cells < 2;
    my $code = @{$cells->[0]{links}}
      ? $cells->[0]{links}[0]
      : _cell_text($cells->[0]);
    next unless $code =~ /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/i;
    my $name = @{$cells->[1]{links}}
      ? $cells->[1]{links}[0]
      : _cell_text($cells->[1]);
    $name = clean_card_name($name);
    next unless length $name;

    my (@rarity, @category);
    if (@$cells > 2) {
      @rarity = @{$cells->[2]{links}}
        ? @{$cells->[2]{links}}
        : (_cell_text($cells->[2]) ? (_cell_text($cells->[2])) : ());
    }
    if (@$cells > 3) {
      @category = @{$cells->[3]{links}}
        ? @{$cells->[3]{links}}
        : (_cell_text($cells->[3]) ? (_cell_text($cells->[3])) : ());
    }
    my (%seen_rarity, %seen_category);
    push @result, {
      set_name => $set_name,
      card_code => trim($code),
      card_name => $name,
      rarity => [grep { !$seen_rarity{$_}++ } @rarity],
      category => [grep { !$seen_category{$_}++ } @category],
      print => '',
    };
  }
  return \@result;
}

sub fetch_released_sets {
  my ($year, $today) = @_;
  $today ||= current_utc_date();
  my $calendar_url = "https://yugipedia.com/wiki/$year";
  my $calendar_html = fetch_text($calendar_url);
  my $product_urls = calendar_product_urls($calendar_html, $year);
  die "No regional release links found on Yugipedia $year\n" unless @$product_urls;

  my %list_urls;
  for my $index (0 .. $#$product_urls) {
    sleep(0.25) if $index;
    my $product_html = fetch_text($product_urls->[$index]);
    $list_urls{$_} = 1 for @{set_list_urls($product_html, $product_urls->[$index])};
  }
  my @list_urls = sort keys %list_urls;
  die "No TCG-EN or OCG-AE card lists found for $year\n" unless @list_urls;

  my $released = { TCG => [], AE => [] };
  for my $index (0 .. $#list_urls) {
    sleep(0.25) if $index;
    my $url = $list_urls[$index];
    my $page = fetch_text($url);
    my $release_date = eval { parse_release_date($page) };
    die "$url: $@" if $@;
    next if $release_date gt $today;
    my $region = list_region($url);
    my $rows = parse_card_rows($page, list_set_name($url));
    die "No card rows parsed from $url\n" unless @$rows;
    push @{$released->{$region}}, @$rows;
  }

  for my $region (qw(TCG AE)) {
    my (%by_code, @deduplicated);
    for my $row (@{$released->{$region}}) {
      if (!exists $by_code{$row->{card_code}}) {
        $by_code{$row->{card_code}} = scalar @deduplicated;
        push @deduplicated, $row;
      } else {
        $deduplicated[$by_code{$row->{card_code}}] = $row;
      }
    }
    $released->{$region} = \@deduplicated;
  }

  printf "Yugipedia %d: %d release pages, %d TCG/AE card lists, %d TCG printings, %d AE printings through %s\n",
    $year, scalar(@$product_urls), scalar(@list_urls),
    scalar(@{$released->{TCG}}), scalar(@{$released->{AE}}), $today;
  return $released;
}

sub merge_ae_printings {
  my ($existing_document, $released_rows) = @_;
  my $existing_rows = $existing_document->{data};
  die "data/ae.json must contain a data array\n" unless ref($existing_rows) eq 'ARRAY';

  my (%by_code, @merged_rows);
  my %existing_names = map { normalize_name($_->{card_name}) => 1 } @$existing_rows;
  for my $row (@$existing_rows) {
    my $code = uc($row->{card_code} || '');
    my $index = $by_code{$code};
    if (defined $index) {
      $merged_rows[$index] = { %{$merged_rows[$index]}, %$row };
    } else {
      $by_code{$code} = scalar @merged_rows;
      push @merged_rows, { %$row };
    }
  }
  for my $row (@$released_rows) {
    my $code = uc($row->{card_code});
    my $index = $by_code{$code};
    if (defined $index) {
      my $previous = $merged_rows[$index];
      my %merged = (%$previous, %$row);
      $merged{print} = $previous->{print} // $row->{print} // '';
      $merged_rows[$index] = \%merged;
    } else {
      my %merged = %$row;
      $merged{print} = 'Reprint' if $existing_names{normalize_name($row->{card_name})};
      $by_code{$code} = scalar @merged_rows;
      push @merged_rows, \%merged;
    }
  }
  return { %$existing_document, data => \@merged_rows };
}

sub project_api_card {
  my ($card, $include_prices, $ae_sets) = @_;
  my %projected = %$card;
  delete @projected{qw(misc_info asian_english_sets card_prices)};
  if ($include_prices && exists $card->{card_prices}) {
    $projected{card_prices} = $card->{card_prices};
  }
  if (!$include_prices && @$ae_sets) {
    $projected{asian_english_sets} = $ae_sets;
  }
  return \%projected;
}

sub merge_card_file {
  my ($document, $api_by_id, $api_ids, $selected_ids, $include_prices, $ae_sets_by_name) = @_;
  my $records = $document->{data};
  die "Card JSON must contain a data array\n" unless ref($records) eq 'ARRAY';

  my (@result, %seen);
  for my $old_card (@$records) {
    my $card_id = defined $old_card->{id} ? "$old_card->{id}" : 'None';
    if ($selected_ids->{$card_id} && exists $api_by_id->{$card_id}) {
      my $api_card = $api_by_id->{$card_id};
      my $name_key = normalize_name($api_card->{name} // $old_card->{name} // '');
      my $ae_sets = $ae_sets_by_name->{$name_key};
      $ae_sets = $old_card->{asian_english_sets} || [] unless $ae_sets && @$ae_sets;
      my $fresh = project_api_card($api_card, $include_prices, $ae_sets);
      my %merged = (%$old_card, %$fresh);
      delete $merged{asian_english_sets} if $include_prices;
      $merged{asian_english_sets} = $ae_sets if !$include_prices && @$ae_sets;
      push @result, \%merged;
    } else {
      push @result, $old_card;
    }
    $seen{$card_id} = 1;
  }
  for my $card_id (@$api_ids) {
    next unless $selected_ids->{$card_id} && !$seen{$card_id};
    my $api_card = $api_by_id->{$card_id};
    my $name_key = normalize_name($api_card->{name} || '');
    my $ae_sets = $ae_sets_by_name->{$name_key} || [];
    push @result, project_api_card($api_card, $include_prices, $ae_sets);
  }
  return { %$document, data => \@result };
}

sub build_updates {
  my ($cards_document, $tcg_document, $ae_document, $api_data, $released_rows) = @_;
  my $merged_ae = merge_ae_printings($ae_document, $released_rows->{AE});
  my %ae_sets_by_name;
  for my $row (@{$merged_ae->{data}}) {
    my $key = normalize_name($row->{card_name} || '');
    next unless length $key;
    my %set = map { exists $row->{$_} ? ($_ => $row->{$_}) : () }
      qw(set_name card_code rarity category print);
    push @{$ae_sets_by_name{$key}}, \%set;
  }

  my (%api_by_id, %api_by_name, @api_ids);
  for my $card (@$api_data) {
    my $card_id = defined $card->{id} ? "$card->{id}" : '';
    my $name_key = normalize_name($card->{name} || '');
    if (length $card_id) {
      $api_by_id{$card_id} = $card;
      push @api_ids, $card_id;
    }
    push @{$api_by_name{$name_key}}, $card_id if length $name_key;
  }
  my %existing_cards = map { (defined $_->{id} ? "$_->{id}" : 'None') => $_ }
    @{$cards_document->{data} || []};
  my %existing_tcg = map { (defined $_->{id} ? "$_->{id}" : 'None') => $_ }
    @{$tcg_document->{data} || []};
  my %existing_names;
  for my $document ($cards_document, $tcg_document) {
    $existing_names{normalize_name($_->{name} || '')} = 1
      for @{$document->{data} || []};
  }
  my %released_tcg_codes = map { normalize_code($_->{card_code}) => 1 }
    @{$released_rows->{TCG}};
  my %released_name_keys;
  for my $rows (values %$released_rows) {
    $released_name_keys{normalize_name($_->{card_name})} = 1 for @$rows;
  }
  my %released_ae_codes_by_name;
  for my $row (@{$released_rows->{AE}}) {
    $released_ae_codes_by_name{normalize_name($row->{card_name})}
      {normalize_code($row->{card_code})} = 1;
  }

  my (@unmatched, %selected_ids);
  for my $region (qw(TCG AE)) {
    for my $row (@{$released_rows->{$region}}) {
      my $name_key = normalize_name($row->{card_name});
      push @unmatched, "$region $row->{card_code} $row->{card_name}"
        unless $api_by_name{$name_key} || $existing_names{$name_key};
    }
  }

  for my $card (@$api_data) {
    my $card_id = defined $card->{id} ? "$card->{id}" : '';
    my $name_key = normalize_name($card->{name} || '');
    my %api_tcg_codes = map {
      normalize_code($_->{set_code} || '') => 1
    } @{$card->{card_sets} || []};
    my $old_cards = $existing_cards{$card_id};
    my $old_tcg = $existing_tcg{$card_id};
    my $old_tcg_sets = $old_tcg ? ($old_tcg->{card_sets} || []) : [];
    my $old_ae_sets = $old_cards ? ($old_cards->{asian_english_sets} || []) : [];
    my %old_tcg_codes = map {
      normalize_code($_->{set_code} || '') => 1
    } @$old_tcg_sets;
    my %old_ae_codes = map {
      normalize_code($_->{card_code} || '') => 1
    } @$old_ae_sets;
    my $expected_ae_codes = $released_ae_codes_by_name{$name_key} || {};
    my $has_new_tcg = grep {
      $released_tcg_codes{$_} && !$old_tcg_codes{$_}
    } keys %api_tcg_codes;
    my $has_new_ae = grep { !$old_ae_codes{$_} } keys %$expected_ae_codes;

    if ($released_name_keys{$name_key} &&
        (!$old_cards || !$old_tcg || $has_new_tcg || $has_new_ae)) {
      $selected_ids{$card_id} = 1;
    }
  }

  my $updated_cards = merge_card_file(
    $cards_document, \%api_by_id, \@api_ids, \%selected_ids, 0, \%ae_sets_by_name
  );
  my $updated_tcg = merge_card_file(
    $tcg_document, \%api_by_id, \@api_ids, \%selected_ids, 1, \%ae_sets_by_name
  );
  return ($updated_cards, $updated_tcg, $merged_ae, \%selected_ids, \@unmatched);
}

sub read_json {
  my ($path) = @_;
  open my $file, '<:raw', $path or die "Unable to read $path: $!\n";
  local $/;
  my $contents = <$file>;
  close $file or die "Unable to close $path: $!\n";
  $contents =~ s/^\xEF\xBB\xBF//;
  my $document = eval { decode_json($contents) };
  die "Invalid JSON in $path: $@" if $@;
  return $document;
}

sub main {
  my ($year, $dry_run) = (substr(current_utc_date(), 0, 4), 0);
  while (@ARGV) {
    my $argument = shift @ARGV;
    if ($argument eq '--dry-run') {
      $dry_run = 1;
    } elsif ($argument eq '--year') {
      die "--year requires a year\n" unless @ARGV;
      $year = shift @ARGV;
      die "Invalid year: $year\n" unless $year =~ /^\d{4}$/;
    } elsif ($argument =~ /^--year=(\d{4})$/) {
      $year = $1;
    } else {
      die "Unknown option: $argument\nUsage: perl Tools/update_card_data.pl [--year YEAR] [--dry-run]\n";
    }
  }

  my $released_rows = fetch_released_sets($year);
  my $api_document = fetch_json($YGOPRODECK_URL);
  my $api_data = $api_document->{data};
  die "YGOPRODeck returned no card data\n"
    unless ref($api_data) eq 'ARRAY' && @$api_data;

  my $cards_document = read_json($CARDS_PATH);
  my $tcg_document = read_json($TCG_PATH);
  my $ae_document = read_json($AE_PATH);
  my ($updated_cards, $updated_tcg, $updated_ae, $selected_ids, $unmatched) =
    build_updates($cards_document, $tcg_document, $ae_document, $api_data, $released_rows);

  my %old_card_ids = map {
    (defined $_->{id} ? "$_->{id}" : 'None') => 1
  } @{$cards_document->{data}};
  my $new_card_count = scalar grep {
    !$old_card_ids{defined $_->{id} ? "$_->{id}" : 'None'}
  } @{$updated_cards->{data}};
  my $new_ae_codes = @{$updated_ae->{data}} - @{$ae_document->{data} || []};
  printf "YGOPRODeck: %d cards; %d cards matched to released TCG/AE lists; %d new card IDs; %d new AE printings\n",
    scalar(@$api_data), scalar(keys %$selected_ids), $new_card_count, $new_ae_codes;

  if (@$unmatched) {
    print STDERR "Warning: " . scalar(@$unmatched) .
      " released card entries are not yet in the local/API catalog; the next scheduled run will retry them.\n";
    print STDERR "  $_\n" for @$unmatched[0 .. ($#$unmatched < 19 ? $#$unmatched : 19)];
  }
  return if $dry_run;

  write_json($CARDS_PATH, $updated_cards);
  write_json($TCG_PATH, $updated_tcg);
  write_json($AE_PATH, $updated_ae);
  print "Updated data/cards.json, data/tcg.json, and data/ae.json\n";
}

unless (caller) {
  eval { main(); 1 } or do {
    my $error = $@ || "Unknown error\n";
    print STDERR "Card data update failed: $error";
    exit 1;
  };
}

1;
