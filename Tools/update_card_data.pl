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
my $OCG_PATH = "$ROOT/data/ocg.json";
my $YGOPRODECK_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes';

sub clean_card_name {
  my ($name) = @_;
  $name = trim($name);
  $name =~ s/\s*\(updated from:.*\)\s*$//i;
  $name =~ s/\s*\(extended art\)\s*$//i;
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
        next unless $prefix =~ /north american|european|oceanic|asian-english|japanese|english/;

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
          ($href =~ /\(TCG-EN\)/ || $href =~ /\(OCG-AE\)/ || $href =~ /\(OCG-JP\)/)) {
        my $absolute = urljoin($product_url, $anchor->{href});
        my ($scheme, $host, $path, $query) = urlsplit($absolute);
        next unless $host eq 'yugipedia.com' && $path =~ m{^/wiki/};
        $absolute = "$scheme://$host$path"
          if $query =~ /(?:^\?|&)action=edit(?:&|$)/i;
        $urls{$absolute} = 1;
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
  return 'OCG' if $path =~ /\(OCG-JP\)$/;
  die "Unsupported Yugipedia card-list URL: $url\n";
}

sub list_set_name {
  my ($url) = @_;
  my @parts = urlsplit($url);
  my $path = $parts[2];
  my ($title) = $path =~ m{^/wiki/(.+)$};
  $title = unquote($title || '');
  $title =~ tr/_/ /;
  my ($name) = $title =~ /^Set Card Lists:\s*(.*?)\s+\((?:TCG-EN|OCG-AE|OCG-JP)\)$/i;
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
    '%B %Y',
    '%b %Y',
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

sub _cell_values {
  my ($cell) = @_;
  return @{$cell->{links}} if @{$cell->{links}};
  return grep { length } map { trim($_) } split /\n+/, $cell->{text};
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
        $cell = { tag => $tag, text => '', links => [] };
      } elsif ($tag eq 'a' && $cell) {
        $anchor = '';
      } elsif ($tag eq 'br' && $cell) {
        $cell->{text} .= "\n";
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
  my %columns = (
    code => 0,
    name => 1,
    rarity => 2,
    category => 3,
    print => undef,
  );
  my $has_rarity_header = 0;
  for my $cells (@rows) {
    next if @$cells < 2;

    if (grep { $_->{tag} eq 'th' } @$cells) {
      %columns = (
        code => 0,
        name => 1,
        rarity => 2,
        category => 3,
        print => undef,
      );
      $has_rarity_header = 0;
      for my $index (0 .. $#$cells) {
        my $header = lc(_cell_text($cells->[$index]));
        $columns{code} = $index
          if $header =~ /\b(?:card\s*(?:number|no\.?|code)|set\s*code|number|code)\b/;
        $columns{name} = $index
          if $header =~ /\benglish\s+name\b|\bcard\s+name\b|^name$/;
        if ($header =~ /\brarity\b/) {
          $columns{rarity} = $index;
          $has_rarity_header = 1;
        }
        $columns{category} = $index if $header =~ /\bcategory\b/;
        $columns{print} = $index if $header =~ /^\s*print\s*$/;
      }
      next;
    }

    my $code_index = $columns{code};
    my $name_index = $columns{name};
    next if $code_index > $#$cells || $name_index > $#$cells;
    my @code_values = _cell_values($cells->[$code_index]);
    my $code = @code_values ? $code_values[0] : _cell_text($cells->[$code_index]);
    next unless $code =~ /^[A-Z0-9]+(?:\/[A-Z0-9]+)*(?:-[A-Z0-9]+)+$/i;
    my @name_values = _cell_values($cells->[$name_index]);
    my $name = @name_values ? $name_values[0] : _cell_text($cells->[$name_index]);
    $name = clean_card_name($name);
    next unless length $name;

    my (@rarity, @category);
    my $rarity_index = $has_rarity_header
      ? $columns{rarity}
      : (@$cells > 4 ? 3 : 2);
    $rarity_index = @$cells > 4 ? 3 : 2 if $rarity_index > $#$cells;
    if ($rarity_index <= $#$cells) {
      @rarity = _cell_values($cells->[$rarity_index]);
      if (_cell_text($cells->[$name_index]) =~ /\bextended\s+art\b/i) {
        @rarity = map { /^Extended Art\b/i ? $_ : "Extended Art $_" } @rarity;
      }
    }
    my $category_index = $columns{category};
    $category_index = $rarity_index + 1
      if !defined($category_index) || $category_index > $#$cells;
    if ($category_index <= $#$cells) {
      @category = _cell_values($cells->[$category_index]);
    }
    my $print = defined($columns{print}) && $columns{print} <= $#$cells
      ? _cell_text($cells->[$columns{print}])
      : '';
    my (%seen_rarity, %seen_category);
    push @result, {
      set_name => $set_name,
      card_code => trim($code),
      card_name => $name,
      rarity => [grep { !$seen_rarity{$_}++ } @rarity],
      category => [grep { !$seen_category{$_}++ } @category],
      print => $print,
    };
  }
  return \@result;
}

sub _merge_printing_rows {
  my ($previous, $incoming) = @_;
  my %merged = (%$previous, %$incoming);
  for my $field (qw(rarity category)) {
    my (@values, %seen);
    for my $row ($previous, $incoming) {
      my $row_values = $row->{$field};
      my @candidates = ref($row_values) eq 'ARRAY'
        ? @$row_values
        : defined($row_values) ? ($row_values) : ();
      for my $value (@candidates) {
        $value = trim($value);
        push @values, $value if length($value) && !$seen{$value}++;
      }
    }
    my $has_published_value = grep { lc($_) ne 'not applicable' } @values;
    @values = grep { lc($_) ne 'not applicable' } @values if $has_published_value;
    $merged{$field} = \@values if exists($previous->{$field}) || exists($incoming->{$field});
  }
  $merged{print} = $previous->{print} || $incoming->{print} || ''
    if exists($previous->{print}) || exists($incoming->{print});
  return \%merged;
}

sub _merge_scraped_printing_rows {
  my ($previous, $incoming) = @_;
  my $merged = _merge_printing_rows($previous, $incoming);
  my $rarities = $incoming->{rarity};
  if (ref($rarities) eq 'ARRAY' && @$rarities) {
    my @rarities = map { trim($_) } @$rarities;
    @rarities = grep { length($_) } @rarities;
    my $has_published_rarity = grep { lc($_) ne 'not applicable' } @rarities;
    @rarities = grep { lc($_) ne 'not applicable' } @rarities
      if $has_published_rarity;
    $merged->{rarity} = \@rarities if @rarities;
  }
  return $merged;
}

sub _printing_key {
  my ($row) = @_;
  return normalize_name($row->{set_name} || '') . '|' .
    normalize_code($row->{card_code} || '');
}

sub deduplicate_printing_rows {
  my ($rows) = @_;
  my (@result, %index);
  for my $row (@$rows) {
    my $key = _printing_key($row);
    if (!exists $index{$key}) {
      $index{$key} = scalar @result;
      push @result, { %$row };
    } else {
      my $position = $index{$key};
      $result[$position] = _merge_printing_rows($result[$position], $row);
    }
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
    sleep(1);
    my $product_html = fetch_text($product_urls->[$index]);
    $list_urls{$_} = 1 for @{set_list_urls($product_html, $product_urls->[$index])};
  }
  my @list_urls = sort keys %list_urls;
  die "No supported regional card lists found for $year\n" unless @list_urls;

  my $released = { TCG => [], AE => [], OCG => [] };
  for my $index (0 .. $#list_urls) {
    sleep(1);
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

  for my $region (qw(TCG AE OCG)) {
    $released->{$region} = deduplicate_printing_rows($released->{$region});
  }

  printf "Yugipedia %d: %d release pages, %d regional card lists, %d TCG printings, %d AE printings, %d OCG printings through %s\n",
    $year, scalar(@$product_urls), scalar(@list_urls),
    scalar(@{$released->{TCG}}), scalar(@{$released->{AE}}),
    scalar(@{$released->{OCG}}), $today;
  return $released;
}

sub merge_ae_printings {
  my ($existing_document, $released_rows) = @_;
  my $existing_rows = $existing_document->{data};
  die "data/ae.json must contain a data array\n" unless ref($existing_rows) eq 'ARRAY';
  my $scraped_rows = deduplicate_printing_rows($released_rows);

  my (%by_printing, @merged_rows);
  my %existing_names = map { normalize_name($_->{card_name}) => 1 } @$existing_rows;
  for my $row (@$existing_rows) {
    my $key = _printing_key($row);
    my $index = $by_printing{$key};
    if (defined $index) {
      $merged_rows[$index] = _merge_printing_rows($merged_rows[$index], $row);
    } else {
      $by_printing{$key} = scalar @merged_rows;
      push @merged_rows, { %$row };
    }
  }
  for my $row (@$scraped_rows) {
    my $key = _printing_key($row);
    my $index = $by_printing{$key};
    if (defined $index) {
      $merged_rows[$index] = _merge_scraped_printing_rows($merged_rows[$index], $row);
    } else {
      my %merged = %$row;
      $merged{print} = 'Reprint' if $existing_names{normalize_name($row->{card_name})};
      $by_printing{$key} = scalar @merged_rows;
      push @merged_rows, \%merged;
    }
  }
  return { %$existing_document, data => \@merged_rows };
}

sub merge_ocg_printings {
  my ($existing_document, $released_rows) = @_;
  my $existing_rows = $existing_document->{data};
  die "data/ocg.json must contain a data array\n" unless ref($existing_rows) eq 'ARRAY';
  my $scraped_rows = deduplicate_printing_rows($released_rows);

  my (%by_printing, @merged_rows);
  for my $row (@$existing_rows) {
    my %printing = map { exists($row->{$_}) ? ($_ => $row->{$_}) : () }
      qw(set_name card_code card_name rarity);
    my $key = _printing_key(\%printing);
    my $index = $by_printing{$key};
    if (defined $index) {
      $merged_rows[$index] = _merge_printing_rows($merged_rows[$index], \%printing);
    } else {
      $by_printing{$key} = scalar @merged_rows;
      push @merged_rows, \%printing;
    }
  }
  for my $row (@$scraped_rows) {
    my %printing = map { exists($row->{$_}) ? ($_ => $row->{$_}) : () }
      qw(set_name card_code card_name rarity);
    my $key = _printing_key(\%printing);
    my $index = $by_printing{$key};
    if (defined $index) {
      $merged_rows[$index] = _merge_scraped_printing_rows($merged_rows[$index], \%printing);
    } else {
      $by_printing{$key} = scalar @merged_rows;
      push @merged_rows, \%printing;
    }
  }
  return { %$existing_document, data => \@merged_rows };
}

sub _tcg_rarity_code {
  my ($rarity) = @_;
  $rarity =~ s/^Extended Art\s+//i;
  my %codes = (
    'Common' => '(C)',
    'Rare' => '(R)',
    'Super Rare' => '(SR)',
    'Ultra Rare' => '(UR)',
    'Secret Rare' => '(ScR)',
    'Prismatic Secret Rare' => '(PScR)',
    'Ultimate Rare' => '(UtR)',
    'Ultra Secret Rare' => '(UtScR)',
    'Starlight Rare' => '(StR)',
    'Collector\'s Rare' => '(CR)',
    'Ghost Rare' => '(GR)',
    'Quarter Century Secret Rare' => '(QCSR)',
  );
  return $codes{$rarity} || '';
}

sub merge_tcg_printings {
  my ($existing_document, $released_rows) = @_;
  my $existing_rows = $existing_document->{data};
  die "TCG JSON must contain a data array\n" unless ref($existing_rows) eq 'ARRAY';

  my (%by_code, %by_name, %rows_by_code);
  for my $index (0 .. $#$existing_rows) {
    my $card = $existing_rows->[$index];
    my $name_key = normalize_name($card->{name} || '');
    push @{$by_name{$name_key}}, $index if length $name_key;
    for my $printing (@{$card->{card_sets} || []}) {
      my $code = normalize_code($printing->{set_code} || '');
      $by_code{$code}{$index} = 1 if length $code;
    }
  }
  for my $row (@$released_rows) {
    my $code = normalize_code($row->{card_code} || '');
    next unless length $code;
    push @{$rows_by_code{$code}}, $row;
  }

  my %variants_by_code;
  for my $code (keys %rows_by_code) {
    my (@variants, %seen);
    for my $row (@{$rows_by_code{$code}}) {
      my $rarities = ref($row->{rarity}) eq 'ARRAY'
        ? $row->{rarity}
        : defined($row->{rarity}) ? [$row->{rarity}] : [];
      for my $rarity (@$rarities) {
        $rarity = trim($rarity);
        push @variants, $rarity if length($rarity) && !$seen{$rarity}++;
      }
    }
    $variants_by_code{$code} = \@variants;
  }

  my %updated_codes;
  my @updated_rows = map { { %$_ } } @$existing_rows;
  for my $code (keys %rows_by_code) {
    next unless @{$variants_by_code{$code}};
    my %matches = %{$by_code{$code} || {}};
    if (!%matches) {
      for my $row (@{$rows_by_code{$code}}) {
        my $name_key = normalize_name($row->{card_name} || '');
        $matches{$_} = 1 for @{$by_name{$name_key} || []};
      }
    }
    next unless %matches;

    my $source = $rows_by_code{$code}[0];
    for my $index (keys %matches) {
      my $card = $updated_rows[$index];
      my $old_sets = $card->{card_sets} || [];
      my %old_by_rarity;
      my $old_price = '0';
      for my $printing (@$old_sets) {
        next unless normalize_code($printing->{set_code} || '') eq $code;
        my $rarity = $printing->{set_rarity} || '';
        $old_by_rarity{$rarity} = $printing;
        $old_price = $printing->{set_price} if defined $printing->{set_price};
      }

      my @replacement_sets;
      for my $rarity (@{$variants_by_code{$code}}) {
        my $old = $old_by_rarity{$rarity};
        push @replacement_sets, {
          set_name => $source->{set_name},
          set_code => $source->{card_code},
          set_rarity => $rarity,
          set_rarity_code => ($old && $old->{set_rarity_code})
            || _tcg_rarity_code($rarity),
          set_price => $old && defined($old->{set_price})
            ? $old->{set_price}
            : $old_price,
        };
      }

      my (@sets, $inserted);
      for my $printing (@$old_sets) {
        if (normalize_code($printing->{set_code} || '') eq $code) {
          if (!$inserted) {
            push @sets, @replacement_sets;
            $inserted = 1;
          }
        } else {
          push @sets, $printing;
        }
      }
      push @sets, @replacement_sets unless $inserted;
      $card->{card_sets} = \@sets;
    }
    $updated_codes{$code} = 1;
  }

  return ({ %$existing_document, data => \@updated_rows }, \%updated_codes);
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
  for my $region (qw(TCG AE)) {
    $released_name_keys{normalize_name($_->{card_name})} = 1
      for @{$released_rows->{$region} || []};
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
  ($updated_tcg) = merge_tcg_printings($updated_tcg, $released_rows->{TCG});
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
  my $ocg_document = read_json($OCG_PATH);
  my ($updated_cards, $updated_tcg, $updated_ae, $selected_ids, $unmatched) =
    build_updates($cards_document, $tcg_document, $ae_document, $api_data, $released_rows);
  my $updated_ocg = merge_ocg_printings($ocg_document, $released_rows->{OCG});

  my %old_card_ids = map {
    (defined $_->{id} ? "$_->{id}" : 'None') => 1
  } @{$cards_document->{data}};
  my $new_card_count = scalar grep {
    !$old_card_ids{defined $_->{id} ? "$_->{id}" : 'None'}
  } @{$updated_cards->{data}};
  my $new_ae_codes = @{$updated_ae->{data}} - @{$ae_document->{data} || []};
  my $new_ocg_codes = @{$updated_ocg->{data}} - @{$ocg_document->{data} || []};
  printf "YGOPRODeck: %d cards; %d cards matched to released TCG/AE lists; %d new card IDs; %d new AE printings; %d new OCG printings\n",
    scalar(@$api_data), scalar(keys %$selected_ids), $new_card_count,
    $new_ae_codes, $new_ocg_codes;

  if (@$unmatched) {
    print STDERR "Warning: " . scalar(@$unmatched) .
      " released card entries are not yet in the local/API catalog; the next scheduled run will retry them.\n";
    print STDERR "  $_\n" for @$unmatched[0 .. ($#$unmatched < 19 ? $#$unmatched : 19)];
  }
  return if $dry_run;

  write_json($CARDS_PATH, $updated_cards, 1);
  write_json($TCG_PATH, $updated_tcg, 1);
  write_json($AE_PATH, $updated_ae, 1);
  write_json($OCG_PATH, $updated_ocg, 1);
  print "Updated data/cards.json, data/tcg.json, data/ae.json, and data/ocg.json\n";
}

unless (caller) {
  eval { main(); 1 } or do {
    my $error = $@ || "Unknown error\n";
    print STDERR "Card data update failed: $error";
    exit 1;
  };
}

1;
