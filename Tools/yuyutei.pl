#!/usr/bin/env perl
use strict;
use warnings;
use utf8;
use open qw(:std :encoding(UTF-8));

use LWP::UserAgent;
use HTTP::Request;
use JSON::PP qw(encode_json);
use URI;
use Time::HiRes qw(sleep);

# Yuyu-tei Yu-Gi-Oh! OCG scraper for YGO-Collect.
#
# Single URL:
#   perl scrape_yuyutei.pl https://yuyu-tei.jp/sell/ygo/card/prb/10524
#
# URL list:
#   perl scrape_yuyutei.pl yuyutei_urls.txt
#
# Output:
#   yuyutei.json
#
# Dependencies:
#   LWP::UserAgent
#   URI
#   JSON::PP (included with modern Perl)

my $OUTPUT = 'yuyutei.json';
my $DELAY  = 2.0;

my $ua = LWP::UserAgent->new(
    agent   => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36 YGO-Collect/1.0',
    timeout => 30,
    max_redirect => 5,
);
$ua->default_header('Accept' => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
$ua->default_header('Accept-Language' => 'ja,en-US;q=0.8,en;q=0.6');
$ua->default_header('Accept-Encoding' => 'gzip, deflate');

sub clean {
    my ($s) = @_;
    return '' unless defined $s;
    $s =~ s/&nbsp;/ /gi;
    $s =~ s/&#160;/ /g;
    $s =~ s/&amp;/&/gi;
    $s =~ s/&quot;/"/gi;
    $s =~ s/&#39;/'/g;
    $s =~ s/&#x27;/'/gi;
    $s =~ s/&lt;/</gi;
    $s =~ s/&gt;/>/gi;
    $s =~ s/&#(\d+);/chr($1)/ge;
    $s =~ s/&#x([0-9a-f]+);/chr(hex($1))/gei;
    $s =~ s/<script\b[^>]*>.*?<\/script>//gis;
    $s =~ s/<style\b[^>]*>.*?<\/style>//gis;
    $s =~ s/<[^>]+>/ /g;
    $s =~ s/\x{3000}/ /g;
    $s =~ s/[\r\n\t]+/ /g;
    $s =~ s/\s+/ /g;
    $s =~ s/^\s+|\s+$//g;
    return $s;
}

sub meta {
    my ($html, $key) = @_;
    my $q = quotemeta($key);
    if ($html =~ /<meta\b[^>]*(?:property|name)\s*=\s*["']$q["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/is) {
        return clean($1);
    }
    if ($html =~ /<meta\b[^>]*content\s*=\s*["']([^"']*)["'][^>]*(?:property|name)\s*=\s*["']$q["'][^>]*>/is) {
        return clean($1);
    }
    return '';
}

sub first_capture {
    my ($html, @patterns) = @_;
    for my $re (@patterns) {
        if ($html =~ $re) {
            return clean($1);
        }
    }
    return '';
}

sub title_and_rarity {
    my ($html) = @_;
    my $title = meta($html, 'og:title');
    $title = first_capture($html, qr/<h1\b[^>]*>(.*?)<\/h1>/is) unless $title;
    $title = first_capture($html, qr/<title\b[^>]*>(.*?)<\/title>/is) unless $title;

    my $rarity = '';
    # The supplied Yuyu-tei page visibly uses "UR 道化の一座 ハット".
    if ($title =~ /^\s*([A-Z0-9]{1,6}(?:th|R|C)?)\s+/i) {
        $rarity = uc($1);
        $title =~ s/^\s*\Q$1\E\s+//i;
    }
    $title =~ s/\s*\|\s*(?:販売|買取).*?$//;
    return (clean($title), $rarity);
}

sub price {
    my ($html) = @_;
    # Matches the visible format in the supplied page: 1,280 円.
    while ($html =~ /([0-9]{1,3}(?:,[0-9]{3})*|[0-9]+)\s*(?:<[^>]*>\s*)*円/gi) {
        my $p = $1;
        $p =~ s/,//g;
        return int($p);
    }
    return undef;
}

sub card_code {
    my ($html) = @_;
    # Yu-Gi-Oh! OCG codes such as YQ12-JP001.
    if ($html =~ /\b([A-Z0-9]{2,8}-JP[0-9A-Z]{2,8})\b/i) {
        return uc($1);
    }
    return '';
}

sub image_url {
    my ($html, $url) = @_;
    my $img = meta($html, 'og:image');
    if (!$img && $html =~ /<img\b[^>]*src\s*=\s*["']([^"']+)["']/is) {
        $img = $1;
    }
    return '' unless $img;
    return URI->new_abs($img, $url)->as_string;
}

sub url_parts {
    my ($url) = @_;
    my ($set, $id) = ('', '');
    if ($url =~ m{/sell/ygo/card/([^/]+)/([0-9]+)}i) {
        ($set, $id) = (lc($1), $2);
    }
    return ($set, $id);
}

sub stock {
    my ($html) = @_;
    # Prefer a quantity input value when present.
    if ($html =~ /在庫.{0,500}?<input\b[^>]*value\s*=\s*["']([0-9]+)["']/is) {
        return int($1);
    }
    if ($html =~ /在庫\s*[：:]?[^0-9]{0,100}([0-9]+)\s*(?:個|枚)?/is) {
        return int($1);
    }
    return undef;
}

sub scrape {
    my ($url) = @_;
    print "Fetching $url\n";

    my $req = HTTP::Request->new(GET => $url);
    $req->header('Referer' => 'https://yuyu-tei.jp/top/ygo');
    $req->header('Cache-Control' => 'no-cache');

    my $res = $ua->request($req);
    unless ($res->is_success) {
        warn "  HTTP error: " . $res->status_line . "\n";
        return;
    }

    my $html = $res->decoded_content(charset => 'none');
    # Yuyu-tei pages are Japanese UTF-8 in normal operation.
    utf8::decode($html) unless utf8::is_utf8($html);

    my ($name, $title_rarity) = title_and_rarity($html);
    my $rarity = $title_rarity;
    $rarity = first_capture($html,
        qr/>\s*(QCSE|QCSER|PSE|25th|20th|UR|SR|SE|SEC|CR|HR|GR|R|N|PR)\s*</i,
        qr/\b(QCSE|QCSER|PSE|25th|20th|UR|SR|SE|SEC|CR|HR|GR|R|N|PR)\b/i
    ) unless $rarity;
    $rarity = uc($rarity) if $rarity;

    my ($set, $product_id) = url_parts($url);
    my $code  = card_code($html);
    my $sell  = price($html);
    my $image = image_url($html, $url);
    my $stock = stock($html);

    my %item = (
        name       => $name,
        cardCode   => $code,
        set        => $set,
        rarity     => $rarity,
        currency   => 'JPY',
        productId  => $product_id,
        image      => $image,
        url        => $url,
        source     => 'yuyu-tei',
    );
    $item{sellPrice} = $sell  if defined $sell;
    $item{stock}     = $stock if defined $stock;

    print "  name:      $item{name}\n";
    print "  cardCode:  " . ($code || '(not found)') . "\n";
    print "  rarity:    " . ($rarity || '(not found)') . "\n";
    print "  sellPrice: " . (defined($sell) ? $sell . ' JPY' : '(not found)') . "\n";
    print "  stock:     " . (defined($stock) ? $stock : '(not found)') . "\n\n";

    return \%item;
}

# Input URLs.
my @urls;
die "Usage: perl scrape_yuyutei.pl URL [URL ...] | urls.txt\n" unless @ARGV;
if (@ARGV == 1 && -f $ARGV[0]) {
    open my $fh, '<', $ARGV[0] or die "Cannot open $ARGV[0]: $!\n";
    while (my $line = <$fh>) {
        chomp $line;
        $line =~ s/^\s+|\s+$//g;
        next if !$line || $line =~ /^#/;
        push @urls, $line if $line =~ m{^https?://(?:www\.)?yuyu-tei\.jp/sell/ygo/card/}i;
    }
    close $fh;
} else {
    @urls = grep { m{^https?://(?:www\.)?yuyu-tei\.jp/sell/ygo/card/}i } @ARGV;
}

my %seen;
@urls = grep { !$seen{$_}++ } @urls;
die "No valid Yuyu-tei Yu-Gi-Oh! card URLs supplied.\n" unless @urls;

my @data;
for my $i (0 .. $#urls) {
    my $item;
    for my $attempt (1 .. 2) {
        $item = scrape($urls[$i]);
        last if $item;
        if ($attempt == 1) {
            print "Retrying in 5 seconds...\n";
            sleep 5;
        }
    }
    push @data, $item if $item;
    sleep $DELAY if $i < $#urls;
}

open my $out, '>:encoding(UTF-8)', $OUTPUT or die "Cannot write $OUTPUT: $!\n";
print $out JSON::PP->new->utf8(0)->pretty(1)->canonical(1)->encode(\@data);
close $out;

print "Saved " . scalar(@data) . " records to $OUTPUT\n";
