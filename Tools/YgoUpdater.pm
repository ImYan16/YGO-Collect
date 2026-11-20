package YgoUpdater;

use strict;
use warnings;
use utf8;
use feature 'fc';
use Exporter 'import';
use Encode qw(encode decode FB_DEFAULT);
use JSON::PP qw(decode_json);
use Time::Piece;
use Time::HiRes qw(sleep);
use Unicode::Normalize qw(NFKC);

our @EXPORT_OK = qw(
  fetch_bytes fetch_text fetch_json write_json html_events text_from_html
  trim normalize_name normalize_code urljoin urlsplit unquote current_utc_date
  valid_iso_date
);

my $USER_AGENT = 'YGO-Collect updater/1.0 (https://github.com/ImYan16/YGO-Collect)';
my $GITHUB_JSON_FILE_LIMIT = 100 * 1024 * 1024;
my @JSON_KEY_ORDER = qw(
  source region data id name typeline type humanReadableCardType frameType desc race
  atk def level
  attribute archetype ygoprodeck_url card_sets set_name set_code set_rarity
  set_rarity_code set_price banlist_info ban_tcg card_images image_url
  image_url_small image_url_cropped asian_english_sets card_code card_name
  rarity category print linkval linkmarkers pend_desc monster_desc
  scale ban_ocg ban_goat card_prices cardmarket_price tcgplayer_price ebay_price
  amazon_price coolstuffinc_price updated Forbidden Limited Semi-Limited
  TCG AE OCG
);
my %JSON_KEY_ORDER = map { $JSON_KEY_ORDER[$_] => $_ } 0 .. $#JSON_KEY_ORDER;
my $JSON_ENCODER = JSON::PP->new->utf8;

sub fetch_bytes {
  my ($url) = @_;
  my @retry_delays = $url =~ m{^https?://(?:www\.)?yugipedia\.com/}i
    ? (10, 30, 60)
    : (1, 2);
  my $attempt = 0;
  while (1) {
    my $pid = open my $pipe, '-|';
    die "Unable to start curl: $!\n" unless defined $pid;
    if (!$pid) {
      exec 'curl', '--fail', '--silent', '--show-error', '--location',
        '--max-time', '45', '--user-agent', $USER_AGENT, $url;
      die "Unable to execute curl: $!\n";
    }

    binmode $pipe;
    local $/;
    my $body = <$pipe>;
    $body = '' unless defined $body;
    my $closed = close $pipe;
    return $body if $closed;
    my $status = $?;
    die "curl failed for $url (exit " . ($status >> 8) . ")\n"
      if $attempt >= @retry_delays;
    sleep($retry_delays[$attempt]);
    $attempt++;
  }
}

sub fetch_text {
  return decode('UTF-8', fetch_bytes($_[0]), FB_DEFAULT);
}

sub fetch_json {
  my ($url) = @_;
  my $decoded = eval { decode_json(fetch_bytes($url)) };
  die "Invalid JSON from $url: $@" if $@;
  return $decoded;
}

sub write_json {
  my ($path, $value, $compact) = @_;
  my $compact_serialized = $compact
    ? $JSON_ENCODER->encode($value) . "\n"
    : undef;
  if (-e $path) {
    open my $existing_file, '<:raw', $path
      or die "Unable to read $path before updating: $!\n";
    local $/;
    my $existing_json = <$existing_file>;
    close $existing_file or die "Unable to close $path: $!\n";
    $existing_json =~ s/^\xEF\xBB\xBF//;
    my $existing = eval { decode_json($existing_json) };
    if (!$@) {
      my $comparer = JSON::PP->new->utf8->canonical;
      if ($comparer->encode($existing) eq $comparer->encode($value)) {
        return if $compact && $existing_json eq $compact_serialized;
        return if !$compact && length($existing_json) < $GITHUB_JSON_FILE_LIMIT;
      }
    }
  }
  my $temporary_path = "$path.tmp";
  my $serialized = $compact_serialized || _encode_pretty_json($value, 0) . "\n";
  if (length($serialized) >= $GITHUB_JSON_FILE_LIMIT) {
    $compact_serialized ||= $JSON_ENCODER->encode($value) . "\n";
    $serialized = $compact_serialized;
  }
  die "Generated JSON for $path exceeds GitHub's 100 MiB file limit even when compacted\n"
    if length($serialized) >= $GITHUB_JSON_FILE_LIMIT;

  open my $file, '>:raw', $temporary_path
    or die "Unable to write $temporary_path: $!\n";
  print {$file} $serialized or die "Unable to write $temporary_path: $!\n";
  close $file or die "Unable to close $temporary_path: $!\n";
  rename $temporary_path, $path
    or die "Unable to replace $path with $temporary_path: $!\n";
}

sub _encode_pretty_json {
  my ($value, $depth) = @_;
  my $indent = ' ' x (2 * $depth);
  if (ref($value) eq 'ARRAY') {
    return '[]' unless @$value;
    return "[\n" . join(",\n", map {
      (' ' x (2 * ($depth + 1))) . _encode_pretty_json($_, $depth + 1)
    } @$value) . "\n$indent]";
  }
  if (ref($value) eq 'HASH') {
    my @keys;
    if (exists $value->{updated} && exists $value->{Forbidden}) {
      my %banlist_order = (
        name => 0,
        source => 1,
        updated => 2,
        Forbidden => 3,
        Limited => 4,
        'Semi-Limited' => 5,
      );
      @keys = sort {
        ($banlist_order{$a} // 10000) <=> ($banlist_order{$b} // 10000)
          || $a cmp $b
      } keys %$value;
    } else {
      @keys = sort {
        ($JSON_KEY_ORDER{$a} // 10000) <=> ($JSON_KEY_ORDER{$b} // 10000)
          || $a cmp $b
      } keys %$value;
    }
    return '{}' unless @keys;
    return "{\n" . join(",\n", map {
      (' ' x (2 * ($depth + 1))) . $JSON_ENCODER->encode($_) . ': ' .
        _encode_pretty_json($value->{$_}, $depth + 1)
    } @keys) . "\n$indent}";
  }
  return $JSON_ENCODER->encode($value);
}

sub trim {
  my ($value) = @_;
  $value = '' unless defined $value;
  $value =~ s/^\s+|\s+$//g;
  return $value;
}

sub _decode_entities {
  my ($value) = @_;
  my %entities = (
    amp => '&', lt => '<', gt => '>', quot => '"', apos => "'",
    nbsp => "\x{00a0}", rsquo => "\x{2019}", lsquo => "\x{2018}",
    rdquo => "\x{201d}", ldquo => "\x{201c}", ndash => "\x{2013}",
    mdash => "\x{2014}", hellip => "\x{2026}", copy => "\x{00a9}",
    reg => "\x{00ae}", trade => "\x{2122}",
  );
  $value =~ s{
    & ( \#(?:x[0-9a-f]+|[0-9]+) | [a-z][a-z0-9]+ ) ;
  }{
    my $entity = $1;
    if ($entity =~ /^\#x([0-9a-f]+)$/i) {
      chr(hex($1));
    } elsif ($entity =~ /^\#([0-9]+)$/) {
      chr($1);
    } else {
      exists $entities{lc $entity} ? $entities{lc $entity} : "&$entity;";
    }
  }gexi;
  return $value;
}

sub html_events {
  my ($html) = @_;
  my @events;
  while ($html =~ /(<[^>]*>|[^<]+)/gs) {
    my $token = $1;
    next if $token =~ /^<!--/s;
    if ($token =~ /^<\s*\/\s*([\w:-]+)/) {
      push @events, { type => 'end', tag => lc $1 };
    } elsif ($token =~ /^<\s*([\w:-]+)(.*?)>$/s) {
      my ($tag, $raw_attributes) = (lc($1), $2);
      my %attributes;
      while ($raw_attributes =~ /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g) {
        my $name = lc $1;
        my $value = defined $2 ? $2 : defined $3 ? $3 : $4;
        $attributes{$name} = _decode_entities($value);
      }
      push @events, {
        type => 'start',
        tag => $tag,
        attributes => \%attributes,
      };
    } else {
      push @events, { type => 'text', data => _decode_entities($token) };
    }
  }
  return \@events;
}

sub text_from_html {
  my ($html) = @_;
  my $events = html_events($html);
  my @parts = map { $_->{data} } grep { $_->{type} eq 'text' } @$events;
  return join ' ', grep { length } map { split /\s+/, trim($_) } @parts;
}

sub normalize_name {
  my ($value) = @_;
  $value = '' unless defined $value;
  $value = fc(NFKC($value));
  $value =~ s/[^\p{Alnum}]//gu;
  return $value;
}

sub normalize_code {
  my ($value) = @_;
  $value = '' unless defined $value;
  $value = uc $value;
  $value =~ s/[^A-Z0-9]//g;
  return $value;
}

sub urlsplit {
  my ($url) = @_;
  return ('', '', $url, '', '') unless $url =~ m{^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$}i;
  return (lc($1), lc($2), $3 || '/', $4 || '', $5 || '');
}

sub urljoin {
  my ($base, $reference) = @_;
  return $reference if $reference =~ m{^[a-z][a-z0-9+.-]*://}i;
  my ($scheme, $host, $path) = urlsplit($base);
  return "$scheme:$reference" if $reference =~ m{^//};
  my ($ref_path) = split /[?#]/, $reference, 2;
  my $joined;
  if ($ref_path =~ m{^/}) {
    $joined = $ref_path;
  } elsif ($ref_path eq '') {
    $joined = $path;
  } else {
    $path =~ s{[^/]*$}{};
    $joined = "$path$ref_path";
  }
  my @segments;
  for my $segment (split m{/+}, $joined) {
    next if $segment eq '' || $segment eq '.';
    if ($segment eq '..') {
      pop @segments if @segments;
    } else {
      push @segments, $segment;
    }
  }
  $joined = '/' . join('/', @segments);
  return "$scheme://$host$joined";
}

sub unquote {
  my ($value) = @_;
  my $bytes = encode('UTF-8', $value);
  $bytes =~ s/%([0-9a-f]{2})/pack('C', hex($1))/gei;
  return decode('UTF-8', $bytes, FB_DEFAULT);
}

sub current_utc_date {
  return gmtime->strftime('%Y-%m-%d');
}

sub valid_iso_date {
  my ($value) = @_;
  my $date = eval { Time::Piece->strptime($value, '%Y-%m-%d') };
  return $date ? 1 : 0;
}

1;
